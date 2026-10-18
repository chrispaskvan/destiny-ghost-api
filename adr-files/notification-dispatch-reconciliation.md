# Notification Dispatch Reconciliation

## Status

Accepted.

## Context

A notification job sends one SMS through Twilio and then records the outcome on the claim check. BullMQ retries a job that throws, which is what makes notifications survive a Bungie outage or a Twilio 503. A retry is also how a recipient got a second copy of a message:

- **A lost answer.** `messages.create` times out, the connection resets, or Twilio answers with a 5xx. Twilio may already have taken the message. The error is transient, so the job is retried, and the retry calls `create` again.
- **A crash after acceptance.** The worker dies after Twilio accepts the message and before anything records that. BullMQ hands the stalled job to another worker, which sends it again.

Queue deduplication cannot help: it keeps a job from being queued twice, not a job from repeating a side effect. Twilio cannot help either. Checked against the API reference and SDK 6.2.0, `messages.create` takes no idempotency key, and a message resource does not return the `statusCallback` it was created with, so the claim-check number in that URL cannot be read back to identify our message.

What Twilio does offer is a list of messages filtered by `to` and `from`, with each message's `body`, `direction` and `dateCreated`. Measured against the live account on 2026-10-18, a message was listed, with its body matching exactly, within a second of `create` answering.

## Decision

**Record the attempt before sending.** Each send for a claim check keeps a record in Redis at `dispatch:<claimCheck>:<phone>`, for a day like the claim check (`helpers/dispatch-record.js`):

| Record | Written | Meaning |
| --- | --- | --- |
| `attempting`, with the exact body and the time | inside the rate limiter's slot, after the consent guard, immediately before `create` | Twilio may have it |
| `accepted`, with the SID | when `create` answers | Twilio has it |
| none | never attempted, or Twilio certainly refused it | nothing went out |

`attempting` is written by a compare-and-set script, and only if the record still holds what the retry read before it waited for the slot. BullMQ can run a stalled job again while the original is still going, and without the comparison the second copy would write over the first copy's record and send again. A copy that loses the comparison sends nothing and reports an unknown outcome, and its next attempt settles whatever the other copy did.

If `attempting` cannot be written, nothing is sent: the send fails with `SendDeferredError` and the job is retried. That trades a delay for never sending blind. The queue lives in the same Redis, so this bites only when the queue is in trouble too. The write is bounded at 250ms, like the consent marker's, because the limiter's slot is one at a time cluster-wide.

**Settle the earlier attempt before trying again.** `sendMessage` reads the record first:

- **None:** send.
- **`accepted`:** return its SID with status `accepted`. Nothing is sent, and Twilio isn't asked: the record already proves the send, and the claim check never moves backwards, so its delivery reports bring the rest.
- **`attempting`:** list the recipient's latest 20 messages from our number and look for one sent by the API, with the recorded body, created no earlier than a minute before the attempt. That minute covers the two clocks disagreeing and Twilio reporting whole seconds.
  - **Found:** adopt it as if `create` had answered.
  - **Not found, and the attempt is at least 5 seconds old:** Twilio never took it. Send.
  - **Not found sooner:** report the outcome as unknown and look again on the next attempt.

The body matched is the recorded one, not the retry's own. A retry can compose different text, such as a Xur inventory read again, and it is the earlier text Twilio would have. Bodies are cut to the length limit without splitting a character: half an emoji goes out as U+FFFD, and Twilio would store text that no longer matches.

The 5 seconds is the measured listing delay with room to spare. It is also shorter than the first retry's 5-second backoff, so the retry after an ambiguous send can decide rather than wait again.

**Treat failures differently by what they prove.**

| Failure | Proves | Policy |
| --- | --- | --- |
| guard withholds | nothing was sent | skip, as before |
| `attempting` cannot be written | nothing was sent | `SendDeferredError`, and BullMQ retries |
| Twilio answers with a status under 500 (a 429 included), or the request never connected (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, unreachable host or network, connect timeout) | Twilio did not take it | drop the record. Rethrow as is: a 429 is retried, a 4xx fails the job permanently. |
| a timeout, a reset, a 5xx, or an error of any kind not recognised above | nothing either way | keep `attempting`, throw `SendOutcomeUnknownError`, and BullMQ retries. The retry reconciles. |
| the record or Twilio's list cannot be read, or another copy of the job got there first | nothing yet | `SendOutcomeUnknownError`, and BullMQ retries. It never guesses. |

Both errors carry no status or code, so the worker rethrows them by type (or by name) rather than letting its catch-all fail the job permanently.

**When the job runs out of attempts still not knowing,** the receipt records `error` with reason `unknown-outcome`, and the worker logs an error naming the claim check and phone, for someone to check Twilio's console. Twilio's reports take precedence over the service's own outcomes (see `twilio-message-status.md`), so if the message did go out, its delivery callback replaces the `error` on its own.

A job that runs out of attempts because the send could never be recorded ends as `retries-exhausted`: nothing was sent, so nobody needs to check.

**The delivery contract is at-least-once, with duplicates narrowed to one case:** a message Twilio took but had not listed within 5 seconds of the attempt. That is much narrower than "any retry after Twilio took the message".

## Consequences

Every send for a claim check now costs two extra Redis writes. A retry costs a Redis read, plus a Twilio fetch or list call.

**Sends without a claim check keep no record.** These are the welcome message, verification codes and keyword acknowledgements. Each answers something the user just did, and a lost one is recovered by the user asking again.

**Unverified:** whether a message still queued at Twilio (no `date_sent`) is listed. The measured one had already gone out by the first look. The lookup uses no date filter, so a listed queued message would match. If one is not listed, that attempt is resent once it is 5 seconds old. This is the duplicate case above.

**The match identifies text, not the operation.** If another claim check sends the same text to the same number between this attempt and its retry, the retry adopts that message as its own. This one's is then never sent, and its receipt reports the other's delivery. It needs identical text, such as the fixed "Xur has closed shop" reply, from two operations within seconds. An upper bound on `dateCreated` cannot rule it out, because the clock-skew allowance is wider than the window.

**Twilio may store a body differently from how it was sent** in ways other than a split character (line endings, for example). The probe's plain text matched exactly. A body that does not match is resent once 5 seconds old.

**A recipient sent more than 20 messages** from our number since the attempt pushes it off the page that is read. This is unlikely within the seconds the lookup covers.

## References

* [#719: reconcile ambiguous provider sends before retrying dispatch](https://github.com/chrispaskvan/destiny-ghost-api/issues/719)
* [#717: race-safe claim-check progress](https://github.com/chrispaskvan/destiny-ghost-api/issues/717)
* [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource)
* `notification-idempotency.md` (deduplication before a job exists) and `twilio-message-status.md` (the receipt this reports to)
