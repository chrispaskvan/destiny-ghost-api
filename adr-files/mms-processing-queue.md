# MMS Processing Queue

## Status

Accepted.

## Context

A player texts a screenshot of a match roster, and the service replies with each player's kill/death ratio. Reading the roster means downloading the image, asking the AI to screen it and then extract the names, and looking each name up with Bungie. That can take longer than Twilio waits for a webhook, so the webhook acknowledged the image straight away and processed it in memory, unawaited. That had two problems:

- **A restart lost the work.** The sender had been told the image was received, and no reply ever came.
- **Nothing tied the work to the message.** If Twilio delivered the same webhook again, the AI analysis ran again, and so did the reply.

Sends had a third, smaller gap. A reply was sent without a record of the attempt, so a retry after Twilio might have taken it would have sent it again. Notification sends already avoid this through the dispatch record (`notification-dispatch-reconciliation.md`).

## Decision

**Queue the image before acknowledging it.** The webhook adds a job to the `mms` queue (`twilio/mms.queue.js`) and only then replies that the image was received. Twilio doesn't redeliver an inbound message whose webhook fails (it only turns to a fallback URL, if one is set), so a failed webhook would drop the image without a word. Instead, an image that can't be queued gets a reply asking the sender to send it again (`MEDIA_RETRY_REPLY`).

**One job per message.** The job is deduplicated on the inbound `MessageSid` for a day, so a second delivery of the same message adds nothing, however it comes about.

**Queue identifiers, not credentials.** A job holds the sender's number, the Twilio media URLs and content types, and the SID. The worker signs its own request for each image when it runs.

**Resume, don't repeat.** `MmsService` is the queue's worker, and works through the images in order:

1. **Consent first.** Before any download, so an image from someone who has opted out since costs nothing. A consent store that can't be read isn't an opt-out here. The image was acknowledged, so the job is retried (`ConsentUnavailableError`) rather than finished with no reply. The same holds for the check before each reply.
2. **Analyze, then save.** Each image's reply text is saved on the job before it is sent. An attempt that follows a crash or a retryable failure skips the images it already analyzed, so the AI is never asked about the same image twice. A save that fails is retried too (`ProgressUnsavedError`), so a Redis blip doesn't cost a roster that was already read.
3. **Send through the dispatch record.** Each reply goes through `sendMessage` with the claim check `mms:<MessageSid>:<index>`, and the failure reply with `mms:<MessageSid>:error`. A retry after Twilio took a reply, or may have, settles it instead of sending it again. Consent is checked again inside the rate limiter's slot, as for any deferred send.

**Retry what can recover.** A retryable failure, such as a download or AI timeout, a 5xx, a send whose outcome is unknown, unreadable consent or an unsaved save, rejects, and BullMQ tries the job again. There are five attempts, as for notifications. A reply whose outcome is unknown can be settled only once Twilio has had time to list it: 40 seconds at most, the request timeout plus the reconciliation wait. Retries landing about 5, 15, 35 and 75 seconds after the first failure leave one after that, and `mms.queue.spec.js` holds the two together. Any other failure is saved on the job, then sends the failure reply and ends the job. If that reply itself hits a retryable error, the job is retried, and the retry goes straight to the failure reply. It doesn't analyze the image again, which could read it this time and send a roster after an apology that may already have gone out.

The last attempt failing sends the failure reply too, through the worker's give-up handler, except when the job gave up not knowing whether Twilio took a reply. That's when the last error was an unknown send outcome, or any image's reply record is still `attempting`, as for a job failed for stalling with a reply mid-send. The sender may have the roster then, so an apology would contradict it. The case is logged as an error to check in Twilio's console. A job given up on after every image's reply was accepted, which only lost its completion, sends no failure reply either. Notifications decide it the same way, through the same helper (`notifications/send-outcome.js`).

**Survive restarts.** A job whose worker dies is picked up again up to five times (`MMS_MAX_STALLED_COUNT`), like a broadcast, since it resumes from its saved progress. A deploy can restart the single instance more than once.

**Bound the work.** Each instance runs two jobs at a time (`MMS_CONCURRENCY`). Each holds an AI call for most of its run, and production runs on a single core.

## Consequences

- An acknowledged image survives a restart. A job interrupted mid-run is picked up again by BullMQ and resumes from its saved progress.
- A reply can still be sent twice only in the case the dispatch record already accepts: a record that expired before the retry that would have settled it.
- Retries multiply. Within each attempt, the download, the upload to the AI and the extraction call each retry transient errors themselves (`withRetry`, up to four tries), so an image the AI keeps failing on can cost up to 20 extraction calls and 20 uploads over five attempts, and an attempt can run for minutes. An image already saved is never sent to the AI again.
- Download and AI failures use up the same five attempts that settling an unknown reply needs. A message that hits several transient failures before an unknown outcome can give up before settling it, and is then logged rather than apologized for.
- While the consent store is down, an image waits through its retries rather than being dropped. If the store is still down after the last one, the failure reply is gated on consent too, so the sender may hear nothing. That is the outcome to prefer over a reply that might follow a STOP.
- Kept jobs are capped at 1000 completed and 500 failed, like the other queues, since each holds its saved reply text.
- Per-sender usage limits are not part of this. They belong with the message and AI cost accounting, so there is one limiter rather than two.
- The failure reply is sent once per message, not once per image.
