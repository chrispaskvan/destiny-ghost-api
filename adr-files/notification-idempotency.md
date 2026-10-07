# Notification Idempotency

## Status

Accepted.

## Context

`POST /notifications/:subscription` broadcasts to every subscriber and answers 202 with a claim check. Clients send an `Idempotency-Key` so a retried request does not broadcast twice.

The first implementation read the key, started the broadcast, then wrote the key. Two concurrent requests could both miss the read and start two broadcasts. The key was stored under the caller's raw string, so it shared a namespace with everything else in the cache, and nothing recorded what the key had been used for: reusing it for a different subscription silently returned the first receipt.

Recipient jobs were deduplicated separately, on notification type and phone number for an hour. That held back a genuine second broadcast inside the hour while its receipt still reported every recipient as queued.

The broadcast itself also ran inside the request's process: the route answered 202 and then queued recipients in the background. A crash after the 202 lost every recipient not yet queued, and nothing would come back for them.

## Decision

**Reserve, then accept.** Before any work starts, the route reserves `idempotency:notifications:<caller>:<key>` with one `SET NX EX 60 GET`, storing the operation's id, a fingerprint of the request, and `state: pending`. The operation id is derived from the request - a SHA-256 of caller, key and fingerprint - rather than minted, so every request carrying the same key for the same request names the same operation. Whichever request lands first reserves the key; every other one reads what it stored, with no window between the check and the write:

| Stored value | Response |
| --- | --- |
| none | Start the broadcast |
| same fingerprint, accepted | 202 with the original claim check; nothing new starts |
| same fingerprint, pending | 409 Conflict with `Retry-After` |
| different fingerprint | 422 Unprocessable Content; nothing starts |

Once the broadcast is recorded (below), a Lua compare-and-set promotes the reservation to `accepted` and extends it to a day, matching the claim check, and the client gets its 202. If the broadcast cannot be recorded, a Lua compare-and-delete releases the key so a retry can. While the reservation is pending, the process holding it renews the 60-second lease every 20 seconds, so a slow request is never mistaken for a dead one. All three scripts act only on the reservation this request made, so a request whose lease ran out cannot touch a newer one. (Azure Managed Redis 7.4 has no `SET IFEQ`, which would do this without Lua.)

**Broadcasts are recorded before they are acknowledged.** Accepting a broadcast adds one job to the `broadcasts` BullMQ queue, with the operation's id as its job id, so recording the same operation twice records it once. The 202 means that job exists. A worker then reads subscribers a page at a time, queues the page's recipients, and saves its cursor and running totals on the job before reading the next page. A recipient that cannot be queued fails the page before anything is saved, so BullMQ's retry comes back to the same page instead of skipping them.

If the process dies part way, the job's lock lapses and BullMQ hands it to the next worker, which starts from the last saved page. That page is queued again, and each recipient's job id (`<operation>-<membershipId>`) makes that a no-op for anyone it already reached. Receipts are initialized with `HSETNX`, so a recipient's status is never set back to `queued`. A broadcast job is picked up again after up to five crashes rather than BullMQ's default of one.

`GET /notifications/broadcasts/:claimCheck` reports the job's state, recipients queued, duplicates found, whether every page is done, and, if it has been retrying, how many times and why.

**Pages are keyed on document id.** Each page is the next 100 subscribers in id order after the cursor, which is the last id the previous page returned (`SELECT TOP 100 … WHERE … AND u.id > @after ORDER BY u.id`). Ids never change, so nobody who stays subscribed throughout a broadcast is skipped, however other documents change meanwhile. A Cosmos continuation token cannot promise that: it bookmarks a position in a query that, without `ORDER BY`, has no defined order. The cursor is taken before opted-out users are dropped, so a page that ends on one still moves on.

**Pages are read live, not from a snapshot.** Someone who subscribes part way through a broadcast is included only if their id is still ahead of the cursor. Someone who opts out part way is still skipped, because consent is checked again at send time.

**Keys are scoped to the caller**, meaning the credential the request authenticated with, so two callers cannot collide on the same key.

**Recipients are deduplicated by event, not by operation.** A broadcast queues each recipient under `<type>-<weekly reset>-<phone>`, where the weekly reset is the Tuesday 17:00 UTC that started the current Destiny week. Two broadcasts for the same week cannot text anyone twice, however they were triggered, and next week's broadcast is never mistaken for this one. A recipient held back this way is recorded as `duplicate` on the receipt rather than `queued`. A single-recipient send is deliberate, so it is deduplicated only within its own operation.

## Consequences

A crash after the 202 no longer depends on the client to recover: the broadcast job resumes on its own. The pending lease now covers only the short window between reserving the key and recording the job; if the process dies there, the key expires within 60 seconds and a retry starts again.

Because the operation id comes from the key, a reservation that lapses after its broadcast was recorded - its accept failed, say - cannot lead to a second broadcast: a retry derives the same id, finds the job already recorded under it, and answers with the original claim check. The flip side is that a key reused after it expires names the old operation again for as long as that broadcast's job is retained (a day after it finishes), and gets its receipt rather than a new broadcast. Clients should use a fresh key per broadcast.

The week a broadcast deduplicates against is fixed when it is accepted and stored on its job, so a broadcast that runs or resumes past Tuesday's reset still belongs to the week it was accepted in.

Crash durability rests on Redis keeping what it was given. The deployment needs persistence enabled and `maxmemory-policy noeviction` (which BullMQ requires anyway); an evicted or lost broadcast job is a lost broadcast. That configuration lives in Azure, not in this repository.

None of this makes delivery exactly-once: queue execution is at-least-once, and a provider call whose outcome is unknown may be retried.

Deduplicating by weekly reset assumes each notification type is a weekly event. A type that needs more than one broadcast a week needs its own event identity.

## References

* [#716: make submission idempotency atomic and operation-scoped](https://github.com/chrispaskvan/destiny-ghost-api/issues/716)
* [#568: make the broadcast notification workflow crash-resumable](https://github.com/chrispaskvan/destiny-ghost-api/issues/568)
* [The Idempotency-Key HTTP Header Field (IETF draft)](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
* [Redis `SET`](https://redis.io/docs/latest/commands/set/)
* [BullMQ deduplication](https://docs.bullmq.io/guide/jobs/deduplication)
* [BullMQ stalled jobs](https://docs.bullmq.io/guide/jobs/stalled)
* [BullMQ production guide: persistence and `noeviction`](https://docs.bullmq.io/guide/going-to-production)
