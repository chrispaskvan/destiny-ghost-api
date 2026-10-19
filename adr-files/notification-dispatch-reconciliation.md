# Notification Dispatch Reconciliation

## Status

Accepted.

## Context

A notification job sends one SMS through Twilio and then records the outcome on the claim check. BullMQ retries a job that throws, which is what makes notifications survive a Bungie outage or a Twilio 503. A retry is also how a recipient got a second copy of a message:

- **A lost answer.** `messages.create` times out, the connection resets, or Twilio answers with a 5xx. Twilio may already have taken the message. The error is transient, so the job is retried, and the retry calls `create` again.
- **A crash after acceptance.** The worker dies after Twilio accepts the message and before anything records that. BullMQ hands the stalled job to another worker, which sends it again.

Queue deduplication cannot help: it keeps a job from being queued twice, not a job from repeating a side effect. Twilio cannot help either. Checked against the API reference and SDK 6.2.0, `messages.create` takes no idempotency key, and a message resource does not return the `statusCallback` it was created with, so the claim-check number in that URL cannot be read back to identify our message.

What Twilio does offer is a list of messages filtered by `to` and `from`, with each message's `body`, `direction` and `dateCreated`. Measured against the live account on 2026-10-18:
- A single message was listed, with its body matching exactly, within a second of `create` answering.
- Of a burst of 8 sent together, the ones Twilio queued were listed within 3.3 seconds, while still `queued` with no `date_sent`. The lag is Twilio's indexing, not the wait to send. Queued messages sat below messages sent after them, not at the top of the list.

## Decision

**Record the attempt before sending.** Each send for a claim check keeps a record in Redis at `dispatch:<claimCheck>:<phone>`, for a day like the claim check (`helpers/dispatch-record.js`):

| Record | Written | Meaning |
| --- | --- | --- |
| `attempting`, with the exact body and the time | once the rate limiter grants a token, after the consent guard, immediately before `create`. When `create`'s answer leaves the outcome unknown, the time that answer came back is added as `failedAt`. | Twilio may have it |
| `accepted`, with the SID | when `create` answers | Twilio has it |
| none | never attempted, or Twilio certainly refused it | nothing went out |

**Every write is a compare-and-replace.** One script writes the record only if it still holds what the writer expects. BullMQ can run a stalled job again while the original is still going, and two copies writing blind could each undo what the other did:
- `begin` expects what the retry read before it waited for a token. Without that, a second copy would write over the first copy's record and send again. A copy that loses the comparison sends nothing and reports an unknown outcome, and its next attempt settles whatever the other copy did.
- Every write after the send (`accepted`, `failedAt`, or dropping the record after a refusal) expects the record that attempt wrote. A copy that has been taken over leaves the newer copy's record alone, whatever it then hears from Twilio.

If `attempting` cannot be written, nothing is sent: the send fails with `SendDeferredError` and the job is retried. That trades a delay for never sending blind. The queue lives in the same Redis, so this bites only when the queue is in trouble too. Every command is bounded at 1 second, like the claim check's. The limiter is a token bucket, so a slow write holds up only its own send.

**Settle the earlier attempt before trying again.** A retry settles it before doing any work: the worker asks the service (`settleEarlier`) before its consent check and its calls to Bungie. A send already made isn't taken back by anything that has changed since, and repeating that work could fail or skip the job before it found out. The worker passes what it found to `sendMessage`, which then doesn't look again. `begin`'s comparison still catches anything that changed during the Bungie work. Callers that don't settle first get the same lookup inside `sendMessage`. Either way, the record is read first:

- **None:** send.
- **`accepted`:** return its SID with status `accepted`. Nothing is sent, and Twilio isn't asked: the record already proves the send, and the claim check never moves backwards, so its delivery reports bring the rest.
- **`attempting`:** list the recipient's latest 20 messages from our number and look for one sent by the API, with the recorded body, created no earlier than 5 seconds before the attempt. That covers the two clocks disagreeing (both are kept by NTP) and Twilio reporting whole seconds. It is kept short on purpose, because it is also how far back another operation's identical message could be mistaken for this one. The list call goes through the rate limiter like every Twilio call, so the retries of a burst of ambiguous sends don't all ask at once and get 429s back.
  - **Found:** adopt it as if `create` had answered.
  - **Not found, and at least 10 seconds have passed since the ambiguous answer:** Twilio never took it. The record is dropped, compared against what was read, so the decision stands: a job that then fails for another reason isn't reported as perhaps having sent it. Send. Counting from the answer matters because a `create` can take most of its timeout before failing, and counting from the begin would use the wait up before the retry looked.
  - **When no answer was recorded,** the attempt crashed, or is still waiting on Twilio in a copy of the job that stalled. The 10 seconds then count from when its request could last have been answered: the begin plus the 30-second request timeout. That timeout is set on the Twilio client where it is created, not left to the library's default, so the two can't drift apart. A crashed job only comes back after stall detection, so this costs it almost nothing.
  - **Not found sooner:** report the outcome as unknown and look again on the next attempt.

The body matched is the recorded one, not the retry's own. A retry can compose different text, such as a Xur inventory read again, and it is the earlier text Twilio would have. Bodies are cut to the length limit without splitting a character: half an emoji goes out as U+FFFD, and Twilio would store text that no longer matches.

The 10 seconds is three times the slowest listing measured.

**The retries have to outlast the wait.** Notification jobs get 5 attempts. With exponential backoff from 5 seconds, the retries land about 5, 15, 35 and 75 seconds after the first failure:
- If Twilio took the message, the first retry finds it.
- If Twilio never took it and the failure was recorded, the third attempt sends.
- If no failure was recorded, the wait runs to 40 seconds after the begin, and the fifth attempt sends. That covers a crash, but also a write that failed while the record was being settled: a late `begin`, or a failed delete or `failedAt`.

With fewer attempts, the job would run out before it could send, and the message would be lost. A publisher spec computes the configured backoff and fails if the last retry comes before the longest wait.

Each send is tried once. BullMQ retries the job, and only a retry of the job settles an earlier attempt first; a retry inside the send would send again without looking.

**Treat failures differently by what they prove.**

| Failure | Proves | Policy |
| --- | --- | --- |
| guard withholds | nothing was sent | skip, as before |
| `attempting` cannot be written, or the rate limiter rejects before the send runs (its Redis down, or its queue full) | nothing was sent | `SendDeferredError`, and BullMQ retries |
| Twilio answers with a status under 500 (a 429 included), or the request never connected (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, unreachable host or network, connect timeout) | Twilio did not take it | drop the record. Rethrow as is: a 429 is retried, a 4xx fails the job permanently. |
| a timeout, a reset, a 5xx, or an error of any kind not recognised above | nothing either way | keep `attempting`, throw `SendOutcomeUnknownError`, and BullMQ retries. The retry reconciles. |
| the record cannot be read | this attempt sent nothing | `SendDeferredError`, and BullMQ retries. It never guesses. |
| Twilio's list cannot be read while there is an attempt to settle, or another copy of the job got there first | nothing yet | `SendOutcomeUnknownError`, and BullMQ retries. It never guesses. |

Both errors carry no status or code. Both extend `RetryableError`, which marks them `retryable` and names each after itself. `isTransientError` honours the marker, so the worker's existing transient check retries them, and its catch-all never makes them permanent. A later error that means "try again" only has to extend the same base.

**When the job runs out of attempts still not knowing,** judged by the record rather than only the last error, the receipt records `error` with reason `unknown-outcome`, and the worker logs an error naming the claim check and phone, for someone to check Twilio's console. Twilio's reports take precedence over the service's own outcomes (see `twilio-message-status.md`), so if the message did go out, its delivery callback replaces the `error` on its own.

The record decides because an attempt that may have reached Twilio can be followed by one that fails for another reason before it looks, such as Bungie down or the job stalling again. If the record says `accepted`, Twilio took the message and only what came after failed, so the receipt records the send as accepted instead of an error. Only if the record can't be read does the last error decide.

A job that runs out of attempts because the send could never be recorded ends as `retries-exhausted`: nothing was sent, so nobody needs to check.

**The delivery contract is at-least-once, with duplicates narrowed to one case:** a message Twilio took but had not listed within 10 seconds of the ambiguous answer. That is much narrower than "any retry after Twilio took the message".

## Consequences

Every send for a claim check now costs two extra Redis writes. A retry costs a Redis read, plus a Twilio fetch or list call.

**Sends without a claim check keep no record.** These are the welcome message, verification codes and keyword acknowledgements. Each answers something the user just did, and a lost one is recovered by the user asking again.

**The listing lag was measured on a burst of 8.** A much deeper Twilio queue might be indexed more slowly. The queued messages were listed before they were sent, which suggests the lag doesn't grow with the queue, but that wasn't measured. A message not listed within 10 seconds is resent. This is the duplicate case above.

**The match identifies text, not the operation.** If another claim check sends the same text to the same number between 5 seconds before this attempt and its retry, the retry adopts that message as its own. This one's is then never sent, and its receipt reports the other's delivery. It needs identical text, such as the fixed "Xur has closed shop" reply, from two operations within seconds.

**Twilio may store a body differently from how it was sent** in ways other than a split character (line endings, for example). The probe's plain text matched exactly. A body that does not match is resent once 10 seconds have passed.

**A paused process can still send late.** A copy that freezes between `begin` and `create` (a VM pause, CPU starvation) for longer than the 40-second wait can send after a stalled copy has already sent. The 30-second request timeout doesn't bound this either. Its timer starts only once the request has a socket, so time spent waiting for a free connection in the agent's pool isn't counted, and it can't fire while the event loop is blocked. A request held up that way still goes out late. Nothing on our side can stop a request a paused process has yet to make: Twilio offers no idempotency key or fencing token to refuse it.

**Instances' clocks are compared.** The 10 seconds is measured on the instance doing the retry, against times another instance may have written. In the stall race, a host whose clock runs 10 seconds or more ahead could take over a send that is still in flight and send it again. NTP keeps instances well inside that. Closing it fully would need Redis's own time on every read as well as every write.

**The 10 seconds was measured on a healthy Twilio.** Ambiguous answers are most likely when Twilio is degraded, which is also when it may list messages most slowly. A message Twilio took but listed later than the window is sent again. If the account turns on message-body redaction, no body matches, and every ambiguous send is resent after the window: the duplicates this replaces, and nothing worse. Waiting longer would trade those duplicates for lost messages, unless the job were given more attempts to wait with.

**An unsettled record errs toward alerting.** A send that certainly never reached Twilio can still leave `attempting` behind: Twilio refused it and the delete failed, or `begin` timed out but its write landed later. If that job then gives up, it ends as `unknown-outcome` and alerts an operator, who checks Twilio and finds nothing. That's the safe direction to be wrong in.

**A recipient sent more than 20 messages** from our number since the attempt pushes it off the page that is read. This is unlikely within the seconds the lookup covers.

## References

* [#719: reconcile ambiguous provider sends before retrying dispatch](https://github.com/chrispaskvan/destiny-ghost-api/issues/719)
* [#717: race-safe claim-check progress](https://github.com/chrispaskvan/destiny-ghost-api/issues/717)
* [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource)
* `notification-idempotency.md` (deduplication before a job exists) and `twilio-message-status.md` (the receipt this reports to)
