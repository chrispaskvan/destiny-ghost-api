# Azure Managed Redis over Azure Cache for Redis

## Status

Accepted. Cut over on 2026-09-27; the Azure Cache for Redis instance is deleted.

## Context

Every Redis workload in the API runs against one Azure Cache for Redis instance,
`gjallarhorn` (Basic C0, 250 MB, Central US, TLS on 6380). Microsoft is retiring the
service: new instances can no longer be created from October 1, 2026, and existing
instances are retired on September 30, 2028. The replacement is Azure Managed Redis,
which is built on Redis Enterprise rather than open-source Redis.

Nothing breaks before 2028, but the creation block matters sooner than the retirement.
From October 2026, losing or needing to rebuild `gjallarhorn` means rebuilding on
Managed Redis anyway, under pressure instead of by choice.

Two clients share that instance, and both take their connection details from
`settings/redis.json` (`host`, `port`, `username`, `password`, `tls`):

* `helpers/cache.js` — `node-redis` (`createClient`), used for cache-aside caching
  (`users/user.cache.js`, `destiny/destiny.cache.js`), sessions through `connect-redis`
  (`helpers/store.js`), the rate limiters, and the consent marker, a Lua script over a
  single key (`helpers/consent-marker.js`).
* `helpers/jobs.js` — `ioredis` (`new Redis`), used by BullMQ in `helpers/publisher.js`
  and `helpers/subscriber.js`.

Both are single-node clients. Neither is cluster-aware, neither selects a database
other than 0, and nothing in the tree calls `CONFIG`, `SELECT`, or subscribes to
keyspace notifications. Peak memory use is under 1 MB.

The differences between the two services that touch this code:

| | Azure Cache for Redis | Azure Managed Redis |
| --- | --- | --- |
| Host suffix | `.redis.cache.windows.net` | `.<region>.redis.azure.net` |
| TLS port | 6380 | 10000 |
| Clustering | Non-clustered on Basic | Clustered by default (OSS or Enterprise); Non-clustered up to 25 GB |
| Databases | 16 | Database 0 only; `SELECT` is blocked |
| Default eviction policy | `volatile-lru` | `volatile-lru`, reportedly fixed once created |
| Authentication | Access keys | Microsoft Entra ID by default; access keys optional |
| Keyspace notifications | Supported | Not supported |
| IP firewall rules | Supported | Not supported; Private Link instead |
| Redis version | 6 | 7.4 |

## Options Considered

### Option A: Stay on Azure Cache for Redis until 2028

No work now. The cost is that the migration still has to happen, and from October 2026
any rebuild is forced onto Managed Redis with no rehearsal behind it.

### Option B: Managed Redis with OSS clustering

Microsoft's recommended policy, and the fastest. It requires cluster clients:
`createCluster` in place of `createClient`, `Redis.Cluster` in place of `new Redis`, and
a hash-tagged BullMQ `prefix` (for example `{bull}`) so each queue's keys land in one
slot, because BullMQ's Lua scripts touch several keys at once. That is a code change
to both clients and every queue, bought for throughput the API does not need.

### Option C: Managed Redis with Enterprise clustering

Presents a single endpoint, so the plain clients connect unchanged. But the proxy
still shards keys, and multi-key scripts whose keys span slots fail. BullMQ depends on
exactly those scripts, so this works until it doesn't.

### Option D: Managed Redis, Non-clustered

A single shard behind a single endpoint: the same shape as today's Basic cache. Both
clients, BullMQ, `connect-redis`, and the consent script work as they are. The only
limit is 25 GB, roughly 25,000 times current use.

## Decision

Option D: migrate to Azure Managed Redis, Non-clustered, with the following fixed at
creation:

* **Clustering policy: Non-clustered.** Keeps both clients single-node and BullMQ's
  multi-key scripts safe, with no code change.
* **Eviction policy: `noeviction`.** BullMQ requires it; under any evicting policy,
  memory pressure can silently delete job state. The trade-off is that at full memory,
  writes fail instead of evicting old cache entries. At under 1 MB used, that is
  theoretical. Microsoft's Q&A reports the policy cannot be changed after creation, so
  getting it wrong means deleting and recreating the instance.
* **High availability: off.** The Basic tier has no replica and no SLA today, and
  Microsoft's migration guide recommends non-HA for Basic migrations; it halves the
  cost. Turning HA on later is a cost decision, not a migration one.
* **TLS: on.** Managed Redis serves one mode per instance; `helpers/cache.js` always
  connects with `rediss://` and `tls: true`.
* **Authentication: access keys enabled.** Managed Redis defaults to Entra ID, and both
  clients authenticate with a key from `settings/redis.json`. Moving to Entra ID is
  worth doing but is a separate decision with its own token-refresh work in both
  clients.

The code does not change. The move is a new instance plus a new `settings/redis.json`.

## Consequences

* The new instance is `gjallarhorn.northcentralus.redis.azure.net`, Balanced 0.5 GB, in
  North Central US rather than the old cache's Central US. The cross-region hop costs a
  few milliseconds per call, accepted in exchange for not recreating the instance.
* `settings/redis.json` gets the new `host`,
  `port: 10000`, the new access key as `password`, and a matching `tls.servername`.
  Managed Redis access keys are documented as password-only. The current `username`
  should either be removed or confirmed to work (`default`) before cutover, not
  discovered after.
* The RESP2 pins in `helpers/cache.js` and `helpers/jobs.js` stay, but for a different
  reason. Their comments used to say the production server did not support RESP3. Against
  the new instance (Redis 7.4.3), `node-redis` connected with RESP3, so that is no longer
  true. The pins now exist because the libraries layered on the clients —
  `rate-limiter-flexible` and `connect-redis` on the cache client, BullMQ on the jobs
  client — parse replies in RESP2 shapes, the unit tests mock Redis and would not catch a
  change in shape, and nothing here uses a RESP3-only feature. The comments say so.
* Managed Redis has no IP firewall rules. If `gjallarhorn` relies on firewall rules
  today, the equivalent is Private Link, and that becomes part of the move.
* Public network access must be enabled explicitly. The instance was created with it
  off, and connections to port 10000 timed out, with no error, until it was turned on
  under Administration → Private Endpoint. With no IP firewall, the access key is then
  the only control on the public endpoint.
* Data does not carry over. The cutover empties the BullMQ queue first. Sessions and
  cache entries are lost, so signed-in users sign in again and caches refill on
  demand. RDB export and import is available if that ever becomes unacceptable.
* The advisor's Entra ID and zone-redundancy prompts on `gjallarhorn` go away with it.
  The same Entra ID recommendation will appear on the new instance and remains open.
* If the API ever outgrows 25 GB or needs clustering, Option B is the path, and it is a
  code change to both clients and every queue name, not a portal setting.

## References

* [Azure Cache for Redis retirement](https://aka.ms/AzureCacheForRedisRetirement)
* [Understand — migrate from Basic, Standard, and Premium tiers to Azure Managed Redis](https://learn.microsoft.com/en-us/azure/redis/migrate/migrate-basic-standard-premium-understand)
* [Migration options](https://learn.microsoft.com/en-us/azure/redis/migrate/migrate-basic-standard-premium-options)
* [How to configure Azure Managed Redis](https://learn.microsoft.com/en-us/azure/redis/configure)
* [Best practices for memory management in Azure Managed Redis](https://learn.microsoft.com/en-us/azure/redis/best-practices-memory-management)
* [Unable to set the eviction policy of an Azure Managed Redis cluster (Microsoft Q&A)](https://learn.microsoft.com/en-us/answers/questions/5871225/unable-to-set-the-eviction-policy-of-our-azure-man)
* [BullMQ — going to production](https://docs.bullmq.io/guide/going-to-production)
* [Redis Client as a Singleton](./redis-client-singleton.md)
