# Notification Idempotency

## Status

Accepted.

## Context

`POST /notifications/:subscription` broadcasts to every subscriber and answers 202 with a claim check. Clients send an `Idempotency-Key` so a retried request does not broadcast twice.

The first implementation read the key, started the broadcast, then wrote the key. Two concurrent requests could both miss the read and start two broadcasts. The key was stored under the caller's raw string, so it shared a namespace with everything else in the cache, and nothing recorded what the key had been used for: reusing it for a different subscription silently returned the first receipt.

Recipient jobs were deduplicated separately, on notification type and phone number for an hour. That held back a genuine second broadcast inside the hour while its receipt still reported every recipient as queued.

## Decision

**Reserve, then accept.** Before any work starts, the route reserves `idempotency:notifications:<caller>:<key>` with one `SET NX EX 60 GET`, storing the new operation's id, a fingerprint of the request, and `state: pending`. Whichever request lands first reserves the key; every other one reads what it stored, with no window between the check and the write:

| Stored value | Response |
| --- | --- |
| none | Start the broadcast |
| same fingerprint, accepted | 202 with the original claim check; nothing new starts |
| same fingerprint, pending | 409 Conflict with `Retry-After` |
| different fingerprint | 422 Unprocessable Content; nothing starts |

The client gets its 202 as soon as the broadcast has started, but the reservation stays pending until every recipient has been queued. Then a Lua compare-and-set promotes it to `accepted` and extends it to a day, matching the claim check. Accepting any earlier would let a replay return a receipt for a broadcast that a crash cut short, with nothing left to finish it.

Two other outcomes release the key with a Lua compare-and-delete: the broadcast fails to start, or some recipients cannot be queued. Either way, a retry can do the missing work.

While the reservation is pending, the process holding it renews the 60-second lease every 20 seconds. A slow subscriber query or a long queueing run is therefore never mistaken for a dead process. All three scripts act only on the reservation this request made, so a request whose lease ran out cannot touch a newer one. (Azure Managed Redis 7.4 has no `SET IFEQ`, which would do this without Lua.)

**Keys are scoped to the caller**, meaning the credential the request authenticated with, so two callers cannot collide on the same key.

**Recipients are deduplicated by event, not by operation.** A broadcast queues each recipient under `<type>-<weekly reset>-<phone>`, where the weekly reset is the Tuesday 17:00 UTC that started the current Destiny week. Two broadcasts for the same week cannot text anyone twice, however they were triggered, and next week's broadcast is never mistaken for this one. A recipient held back this way is recorded as `duplicate` on the receipt rather than `queued`. A single-recipient send is deliberate, so it is deduplicated only within its own operation.

## Consequences

The pending lease is the recovery path when the process dies before a broadcast is fully queued. Renewals stop, the key expires within 60 seconds, and a retry starts a fresh operation. Any recipients the failed attempt had already queued are absorbed by the weekly deduplication, so the retry queues only what is missing. While the broadcast is still being queued, replays are told to retry (409) rather than given the receipt.

This recovery depends on the client retrying. A client that took the first 202 as final will not, so a crash after that response still loses the unqueued recipients until #568 records the broadcast durably.

None of this makes delivery exactly-once: queue execution is at-least-once, and a provider call whose outcome is unknown may be retried.

Deduplicating by weekly reset assumes each notification type is a weekly event. A type that needs more than one broadcast a week needs its own event identity.

## References

* [#716: make submission idempotency atomic and operation-scoped](https://github.com/chrispaskvan/destiny-ghost-api/issues/716)
* [The Idempotency-Key HTTP Header Field (IETF draft)](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
* [Redis `SET`](https://redis.io/docs/latest/commands/set/)
* [BullMQ deduplication](https://docs.bullmq.io/guide/jobs/deduplication)
