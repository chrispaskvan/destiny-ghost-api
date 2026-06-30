# SQLite Driver: node:sqlite over better-sqlite3

## Status

Accepted.

## Context

The API uses SQLite as a read-only data store for the Destiny and Destiny 2 content
databases (grimoire cards, vendor definitions). Queries run inside a `tinypool` worker
thread pool managed by `helpers/pool.js` → `helpers/worker.js` to keep SQLite off the
main event loop thread.

Since the migration to Node.js 26, the container crashes with a segmentation fault
whenever a worker thread exits after opening a database connection. The crash originates
inside V8's isolate teardown (`CppHeap::StartDetachingIsolate`), where weak callbacks
attempt to execute code from a `.node` binary that has already been unloaded from the
worker's address space. The full analysis is tracked upstream at
[WiseLibs/better-sqlite3#1476](https://github.com/WiseLibs/better-sqlite3/issues/1476).
A fix exists in PR #1477 but is unmerged as of June 2026.

This is a fundamental incompatibility between native addons and the worker-thread
lifecycle model introduced in Node.js 26 — not a configuration issue that can be
worked around at the application layer.

## Options Considered

### Option A: Pin better-sqlite3 to a fixed Node.js version

Freeze the runtime at Node.js 24 LTS until the upstream fix lands. Defers the problem
rather than solving it. Node 24 enters maintenance LTS in late 2026 and the upstream
timeline is unknown. We would also lose the Temporal API stabilization, the updated
Permission Model network controls (`--allow-net`), and the built-in `node:sqlite`
module — all shipped in Node 26.

### Option B: Patch better-sqlite3 locally

Apply the diff from PR #1477 via `patch-package` and carry it forward until upstream
merges. Viable in the short term, but `patch-package` adds install-time surface area,
requires ongoing rebase when new `better-sqlite3` releases land, and disappears
silently if the patch fails to apply cleanly. The operational cost outweighs the
bridge value given Option C exists.

### Option C: Replace with node:sqlite (DatabaseSync)

Node.js 22 introduced `node:sqlite` as an experimental built-in. Node.js 26 promoted
it to stable. It ships a synchronous API (`DatabaseSync`, `StatementSync`) that is
intentionally API-compatible with `better-sqlite3`'s surface — the same
`prepare(sql).all()` pattern, the same synchronous execution model, the same
WAL-mode pragma support. Because it is implemented inside the Node.js core binary
rather than as a separate `.node` addon, there is nothing for V8 to unload during
worker thread teardown. The crash class does not exist.

## Decision

Replace `better-sqlite3` with `node:sqlite` (`DatabaseSync`).

The API surface used by `helpers/worker.js` maps directly: constructor options, prepared
statements, and `stmt.all()` are identical in behaviour. The one naming difference is
the read-only constructor flag — `better-sqlite3` used `readonly` (lowercase), while
`node:sqlite` uses `readOnly` (camelCase). Both enforce read-only at the SQLite SQLITE_OPEN_READONLY
level; a non-existent file produces the same `unable to open database file` error under
either driver.

### Performance trade-off

Published benchmarks ([takymt/node-builtin-sqlite-bench](https://github.com/takymt/node-builtin-sqlite-bench),
200k-row table) show `better-sqlite3` outperforming `node:sqlite` by 1.6× on full
table scans and up to 3.4× on point lookups. This gap is real but irrelevant to this
workload: the worker pool runs a fixed set of bootstrap queries once at startup and
once per manifest refresh. A 0.5 ms query becoming 0.85 ms is indistinguishable from
the surrounding file I/O and network latency. If the workload ever shifts toward
high-frequency in-process queries, revisiting this decision is warranted — at which
point `node:sqlite` will likely have closed more of the gap through continued core
investment.

### Build toolchain simplification

`better-sqlite3` compiles a C++ addon via `node-gyp`, which required `gcc`, `g++`,
`make`, `python3`, and `libc6-dev` in the Docker builder stage. With `node:sqlite`
there is no native addon and no compilation step. The `apt-get install` block was
removed entirely from the Dockerfile, making the builder stage smaller and faster.
The `better-sqlite3` entry was also dropped from `pnpm.onlyBuiltDependencies`.

## Consequences

- `helpers/worker.js` imports `{ DatabaseSync }` from `node:sqlite` instead of the
  default export from `better-sqlite3`. The implementation is otherwise unchanged.
- The vitest mock in `helpers/worker.spec.js` targets `node:sqlite` rather than
  `better-sqlite3`. Because `node:sqlite` exports a named class rather than a default
  export, the mock factory uses `{ DatabaseSync: vi.fn() }`.
- The Docker builder stage no longer installs a C++ toolchain. The remaining packages
  in `pnpm.onlyBuiltDependencies` (`@google/genai`, `msgpackr-extract`, `protobufjs`)
  either ship platform prebuilt binaries or run pure-JS postinstall scripts.
- `node:sqlite` is a runtime dependency on Node.js ≥ 22. The `engines.node` field is
  already pinned to `>=26.0.0 <27`, so no additional constraint is required.
- Raw SQLite throughput is lower by 1.6–3.4× for simple queries. Acceptable given the
  read-only, low-frequency, bootstrap-only access pattern.

## References

- [Node.js 26 — node:sqlite stable](https://nodejs.org/docs/latest-v26.x/api/sqlite.html)
- [WiseLibs/better-sqlite3#1476 — segfault on Node 26 worker thread exit](https://github.com/WiseLibs/better-sqlite3/issues/1476)
- [takymt/node-builtin-sqlite-bench — performance comparison](https://github.com/takymt/node-builtin-sqlite-bench)
