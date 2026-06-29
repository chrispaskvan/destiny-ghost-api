# pnpm as the Package Manager

## Status

Accepted.

## Context

The API is currently installed with npm. The lockfile is `package-lock.json` (~12k lines), the on-disk `node_modules` is roughly 500 MB, and both Dockerfile stages run `npm ci` against an `npm` cache mount. Husky's pre-commit and pre-push hooks shell out to `npm run lint` and `npm test`. The single GitHub Actions workflow only uploads coverage to Codacy and does not install dependencies.

Three things have prompted a fresh look at the package manager:

1. Disk and install-time cost. With ~80 direct dependencies and a heavy native subgraph (`better-sqlite3`, `@grpc/grpc-js`, `bullmq`, `applicationinsights`), repeated installs across local checkouts and Docker layers add up.
2. Phantom-dependency risk. npm's flat `node_modules` will happily resolve a transitive package that was never declared, which means accidental imports compile fine until the parent dep changes.
3. The `engines.npm >= 10.0.0` constraint is the only thing tying us to npm, and corepack is now the standard way to pin a package manager regardless of which one is chosen.

The scope of this decision is intentionally limited to `destiny-ghost-api`. The frontend (`destiny-ghost-app`) and the root multi-stage Dockerfile that bundles both apps under supervisord are explicitly out of scope, with the caveat noted under Consequences.

## Options Considered

### Option A: Stay on npm

No change. npm 10 is bundled with the supported Node versions, the Dockerfile already benefits from a BuildKit cache mount, and `package-lock.json` is well understood by every contributor and tool in the chain (Snyk, Codacy, Renovate-style flows if added later). The downside is that we keep the flat `node_modules` and the duplication that comes with it — and we accept that any accidental import from a transitive will keep working until something upstream rearranges the tree.

### Option B: Switch to pnpm

Replace `package-lock.json` with `pnpm-lock.yaml`, install via the global content-addressable store, and surface dependencies through a non-flat, symlinked `node_modules`. Pin via `corepack` and `packageManager` in `package.json` so contributors do not need a global pnpm install. The wins are concrete: a single store shared across this and any other pnpm project on the machine, materially faster cold installs, and a strict `node_modules` layout that makes phantom-dependency bugs impossible by construction.

The costs are also concrete and have to be planned for, not waved past:

* The npm-style `overrides` block in `package.json` was deleted as part of removing `nodemailer-smtp-transport` (see commit history); a future pnpm migration starts with no overrides to translate. New `pnpm.overrides` would only be needed if Snyk re-flags a transitive in the meantime.
* pnpm v9+ blocks postinstall scripts unless the package is allow-listed in `pnpm.onlyBuiltDependencies`. `better-sqlite3` and `@snyk/protect` will need entries; native deps that silently `node-gyp`-built under npm will otherwise fail to compile.
* Both Dockerfile stages need to switch from `npm ci` to `pnpm install --frozen-lockfile`, and the cache mount target changes from `/root/.npm` to the pnpm store path. The root monorepo `Dockerfile` also runs `npm ci --omit=dev` against the API directory; that line needs to flip in the same change set even though the frontend stays on npm.
* Husky hooks (`.husky/pre-commit`, `.husky/pre-push`) and the `start:dev` script invoke `npm` directly and need to be retargeted to `pnpm`.
* Snyk's `@snyk/protect` and the implicit `"snyk": true` flag in `package.json` work with pnpm but should be re-verified against the produced `pnpm-lock.yaml` before turning the migration loose.

#### Spike: Node `--permission` interaction with pnpm symlinks (resolved)

The original concern was that `--permission --allow-fs-read=./` would reject reads through pnpm's `node_modules/<pkg>` symlinks because the realpath escapes the project directory into the global store. A standalone reproduction (Node 22.22, pnpm 10.33, deps drawn from the API: `nodemailer`, `pino`, `lru-cache`) confirms this does not happen in the default configuration:

* `node_modules/<pkg>` resolves via realpath to `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>`, which is still under cwd.
* Files inside `.pnpm/` are content-addressable hardlinks that share inodes with the global store (verified with `stat -c %i` on both sides). At the filesystem level Node sees them as ordinary files inside the project — it never has to follow a path back to `~/.local/share/pnpm/store/`.
* Running `node --permission --allow-fs-read=./ --allow-worker --allow-addons start.js` against the pnpm-installed deps printed `OK` and resolved all three modules.
* A negative control (`--allow-fs-read=/tmp` only) failed at the very first `package_json_reader.read` call with `Access to this API has been restricted`, confirming the positive run was not a no-op.
* An in-tree store variant (`store-dir=./.pnpm-store`, `package-import-method=hardlink` in `.npmrc`) produced the same successful result and is what we should use in the Dockerfile to keep store and project on the same filesystem (so hardlinks never silently fall back to copy or symlink across an overlay boundary).

The remaining risk is narrow: if a Docker `RUN --mount=type=cache,target=…` cache mount lands on a different filesystem than the workdir, pnpm's hardlink fallback chain (hardlink → copy → symlink, depending on version and config) could in principle land on symlinks and break the permission envelope. Pinning the store inside the workdir avoids this entirely.

### Option C: Switch to Yarn Berry

Mentioned for completeness. Yarn 4 with PnP would solve the same phantom-dep problem and offer comparable install speed, but PnP frequently requires resolution shims for tools that expect a real `node_modules` (Snyk being the obvious risk here), and the contributor mental model is further from what we have today than pnpm is. Not pursued further.

## Decision

Adopt pnpm for `destiny-ghost-api`. The `--permission` interaction was the primary risk and the spike (above) shows it does not materialize when the pnpm store is co-located with the project on the same filesystem and `package-import-method=hardlink` is set. The remaining open question is `@snyk/protect` / Snyk CLI behavior against `pnpm-lock.yaml`, which can be settled in the migration PR rather than ahead of it. If Snyk fails and can't be worked around, fall back to `node-linker=hoisted` (gives up the strict-deps benefit but keeps the speed and disk wins).

The migration is worth doing primarily for strict dependency resolution; the disk and speed wins are real but secondary. The ESLint → Biome migration tracked in #604 is a useful template — same scope (API only), same pattern (lockfile churn in a single PR, hook and Dockerfile updates batched together).

## Consequences

The migration replaces `package-lock.json` with `pnpm-lock.yaml` in a single PR, updates both Dockerfile stages, both husky hooks, the `start:dev` script, the `overrides` block, and the `engines` field (drop `npm`, add `pnpm`, set `packageManager` for corepack). Contributors need corepack enabled (`corepack enable`) — the `packageManager` field handles version pinning automatically from there.

The root multi-stage `Dockerfile` at the repository root will no longer be able to assume npm for the API directory. That file still installs the frontend with npm, so it ends up running both package managers in the same image. This is acceptable but is the main reason the long-term right answer is probably a single pnpm workspace at the repo root — call that out as a follow-up rather than letting it derail this decision.

Anything that today imports a transitive without declaring it will fail to install or fail at runtime under pnpm's strict layout. That is the feature, but it should be expected to surface at least one or two missing-dep additions during the spike.

## Action Items

1. \~~Spike Node `--permission` against pnpm symlinks.~~ Done (see above) — works with default hardlink mode; recommend pinning the store in-tree for the Docker build.
2. Open an issue mirroring #604 (ESLint → Biome) covering: `package.json` (engines, packageManager, onlyBuiltDependencies), both Dockerfiles, both husky hooks, the `start:dev` script, README install instructions, lockfile regeneration, and a project-level `.npmrc` with `store-dir=./.pnpm-store` and `package-import-method=hardlink`.
3. Re-run Snyk against `pnpm-lock.yaml` and confirm Codacy continues to ingest coverage unchanged.
4. File a follow-up issue to evaluate a repo-root pnpm workspace covering both API and frontend, with the root `Dockerfile` consolidating onto a single install.

## References

* [pnpm vs npm feature comparison](https://pnpm.io/feature-comparison)
* [pnpm overrides](https://pnpm.io/package_json#pnpmoverrides)
* [pnpm onlyBuiltDependencies](https://pnpm.io/package_json#pnpmonlybuiltdependencies)
* [Node.js Permission Model](https://nodejs.org/api/permissions.html)
* [Corepack](https://nodejs.org/api/corepack.html)
