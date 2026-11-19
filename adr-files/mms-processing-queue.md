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

1. **Consent first.** Before any download, so an image from someone who has opted out since costs nothing.
2. **Analyze, then save.** Each image's reply text is saved on the job before it is sent. An attempt that follows a crash or a retryable failure skips the images it already analyzed, so the AI is never asked about the same image twice.
3. **Send through the dispatch record.** Each reply goes through `sendMessage` with the claim check `mms:<MessageSid>:<index>`, and the failure reply with `mms:<MessageSid>:error`. A retry after Twilio took a reply, or may have, settles it instead of sending it again. Consent is checked again inside the rate limiter's slot, as for any deferred send.

**Retry what can recover.** A retryable failure, such as a download or AI timeout, a 5xx, or a send whose outcome is unknown, rejects, and BullMQ tries the job again, up to three attempts. Any other failure sends the failure reply and ends the job. So does the last attempt failing, through the worker's give-up handler.

**Bound the work.** Each instance runs two jobs at a time (`MMS_CONCURRENCY`). Each holds an AI call for most of its run, and production runs on a single core.

## Consequences

- An acknowledged image survives a restart. A job interrupted mid-run is picked up again by BullMQ and resumes from its saved progress.
- A reply can still be sent twice only in the case the dispatch record already accepts: a record that expired before the retry that would have settled it.
- An image whose progress couldn't be saved is treated like any other failure: a retryable one analyzes it again on the next attempt, which costs one more AI call but never a second reply.
- Per-sender usage limits are not part of this. They belong with the message and AI cost accounting, so there is one limiter rather than two.
- The failure reply is sent once per message, not once per image.
