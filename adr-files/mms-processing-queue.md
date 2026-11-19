# MMS Processing Queue

## Status

Accepted.

## Context

A player texts a screenshot of a match roster, and the service replies with each player's kill/death ratio. Reading the roster means downloading the image, asking the AI to screen it and then extract the names, and looking each name up with Bungie. That can take longer than Twilio waits for a webhook, so the webhook acknowledged the image straight away and processed it in memory, unawaited. That had two problems:

- **A restart lost the work.** The sender had been told the image was received, and no reply ever came.
- **Nothing tied the work to the message.** If Twilio delivered the same webhook again, the AI analysis ran again, and so did the reply.

Sends had a third, smaller gap. A reply was sent without a record of the attempt, so a retry after Twilio might have taken it would have sent it again. Notification sends already avoid this through the dispatch record (`notification-dispatch-reconciliation.md`).

## Decision

**Queue the image before acknowledging it.** The webhook adds a job to the `mms` queue (`twilio/mms.queue.js`) and only then replies that the image was received. If the job can't be added, the webhook fails, so Twilio is free to deliver the message again rather than having been told it arrived.

**One job per message.** The job is deduplicated on the inbound `MessageSid` for a day, far longer than Twilio keeps redelivering, so a second delivery of the same message adds nothing.

**Queue identifiers, not credentials.** A job holds the sender's number, the Twilio media URLs and content types, and the SID. The worker signs its own request for each image when it runs.

**Resume, don't repeat.** `MmsService` is the queue's worker, and works through the images in order:

1. **Consent first.** Before any download, so an image from someone who has opted out since costs nothing. A consent store that can't be read isn't an opt-out here. The image was acknowledged, so the job is retried (`ConsentUnavailableError`) rather than finished with no reply. The same holds for the check before each reply.
2. **Analyze, then save.** Each image's reply text is saved on the job before it is sent. An attempt that follows a crash or a retryable failure skips the images it already analyzed, so the AI is never asked about the same image twice. A save that fails is retried too (`ProgressUnsavedError`), so a Redis blip doesn't cost a roster that was already read.
3. **Send through the dispatch record.** Each reply goes through `sendMessage` with the claim check `mms:<MessageSid>:<index>`, and the failure reply with `mms:<MessageSid>:error`. A retry after Twilio took a reply, or may have, settles it instead of sending it again. Consent is checked again inside the rate limiter's slot, as for any deferred send.

**Retry what can recover.** A retryable failure, such as a download or AI timeout, a 5xx, a send whose outcome is unknown, unreadable consent or an unsaved save, rejects, and BullMQ tries the job again. There are five attempts, as for notifications. A reply whose outcome is unknown can be settled only once Twilio has had time to list it: 40 seconds at most, the request timeout plus the reconciliation wait. Retries landing about 5, 15, 35 and 75 seconds after the first failure leave one after that, and `mms.queue.spec.js` holds the two together. Any other failure sends the failure reply and ends the job. So does the last attempt failing, through the worker's give-up handler.

**Bound the work.** Each instance runs two jobs at a time (`MMS_CONCURRENCY`). Each holds an AI call for most of its run, and production runs on a single core.

## Consequences

- An acknowledged image survives a restart. A job interrupted mid-run is picked up again by BullMQ and resumes from its saved progress.
- A reply can still be sent twice only in the case the dispatch record already accepts: a record that expired before the retry that would have settled it.
- A job stuck on a failing AI call makes up to five calls for the image it can't get past, but never repeats one for an image already saved.
- While the consent store is down, an image waits through its retries rather than being dropped. If the store is still down after the last one, the failure reply is gated on consent too, so the sender may hear nothing. That is the outcome to prefer over a reply that might follow a STOP.
- Per-sender usage limits are not part of this. They belong with the message and AI cost accounting, so there is one limiter rather than two.
- The failure reply is sent once per message, not once per image.
