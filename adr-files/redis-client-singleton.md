# Redis Client as a Singleton

## Status

Accepted.

## Context

More than one type of cache store existed. The decision was made to streamline all caching to use Redis. In order to support horizontal scaling, the Redis client was to be shared as a singleton across modules such that each instance of the server would only manage the connections for a single client.

The intent was to be able to call the "quit" method on Redis client as part of the graceful shutdown coordintated by GoDaddy's Terminus.

## Decision

Upon implementing the shared singleton Redis client, the unit tests started reporting possible memory leaks upon completion.

> A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --runInBand --detectOpenHandles to find leaks.

The way Jest caches a required module causes this behavior. The solution was to use 'redis-mock' in the cache module when NODE_ENV=test.

## Consequences

There's a condition require based on NODE_ENV in './helpers/cache.js' which is not ideal. The unit tests will report memory leaks if NODE_ENV does not equal "test" when running Jest.

## References

* [Unable to reuse Redis connections](https://github.com/OptimalBits/bull/issues/841)
* [Jest memory problems in node environment](https://github.com/facebook/jest/issues/6399)