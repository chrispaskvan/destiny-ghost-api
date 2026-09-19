# Application Insights: In-Process SDK over Codeless Attach

## Status

Accepted.

## Context

Telemetry reaches Application Insights through two independent paths, and only one of
them is ours.

The first is `helpers/application-insights.js`, which imports `applicationinsights`
(3.16.0) as a production dependency, calls `setup()` with the instrumentation key from
configuration, and disables auto-collection of requests, performance counters, and
dependencies. What remains is custom metrics: `server.js` records `startup-time`,
`helpers/publisher.js` records notification volume, and `health/health.controller.js`
records health probe results. This is the path the code knows about.

The second is Azure App Service *codeless attach* — also called auto-instrumentation —
which is turned on by the `ApplicationInsightsAgent_EXTENSION_VERSION` app setting. App
Service injects `NODE_OPTIONS=--require /agents/nodejs/build/src/Loader.js` into every
Node.js process in the container, loading a platform-managed copy of the SDK before the
application starts. Nobody in this repository asked for it; it arrives from the site
configuration.

Since the migration to Node.js 26 and the container's Permission Model, the injected
agent has been logging two errors on every container start, four times over, once per
Node process — the `pnpm` wrapper, the application, and the worker threads:

```
Failed to get authentication credential and enable AAD.TypeError: Cannot read properties of undefined (reading 'prototype')

Error creating Application Insights status folder Error: Access to this API has been restricted. Use --allow-fs-write to manage permissions.
    at Object.mkdirSync (node:fs:1734:26)
    at mkDirByPathSync (/agents/nodejs/node_modules/applicationinsights/out/Bootstrap/Helpers/FileHelpers.js:41:33)
    at new FileWriter (/agents/nodejs/node_modules/applicationinsights/out/Bootstrap/FileWriter.js:50:75)
  code: 'ERR_ACCESS_DENIED',
  permission: 'FileSystemWrite',
  resource: '/var'
```

**The status folder failure.** The agent writes its attach status to
`/var/log/applicationinsights`. Its `mkDirByPathSync` reduces over the path segments
from the filesystem root, so the very first call is `mkdirSync('/var')`. Under
`--permission`, the authorization check runs *before* the syscall, so an ungranted
directory is denied whether or not it already exists — `EEXIST` never gets a chance to
short-circuit the walk. Verified on Node.js 26.8.1 with the production flags:

```
/private/var      -> ERR_ACCESS_DENIED FileSystemWrite /private/var
/private/var/log  -> EEXIST            (granted, harmless)
```

Creating the directory ahead of time in the Dockerfile therefore does not help. Only a
write grant on `/var` itself silences it. This is a regression from
[#704](https://github.com/chrispaskvan/destiny-ghost-api/pull/704), which narrowed the
blanket `--allow-fs-write=/var/` to `/var/log/` and `/var/tmp/`. The `/var/log/` half
was kept specifically for this agent and cannot work, because the agent never gets past
`/var`.

**The AAD failure.** The agent only reaches that code path when the
`APPLICATIONINSIGHTS_AUTHENTICATION_STRING` app setting requests `Authorization=AAD`;
constructing `ManagedIdentityCredential` then throws inside the agent's bundled copy of
`@azure/identity`. Reading `prototype` of `undefined` is the signature of a TypeScript
`__extends` helper receiving an undefined base class — old bundled dependencies meeting
a runtime they predate. It also appears in the `pnpm` parent process, which runs without
`--permission`, so it is not a Permission Model problem and nothing in this repository
can fix it.

Both failures originate at the top level of `Loader.js`, before the agent decides
whether to attach at all. That decision is `_sdkAlreadyExists()`: the agent resolves
`applicationinsights` from the working directory and stands down when the application
carries its own SDK — which this one does. The errors are the cost of a component that
was never going to instrument anything here.

Microsoft's own guidance points the same direction. Node.js auto-instrumentation on App
Service Linux is still in public preview, and the documentation steers applications that
need custom telemetry toward code-based instrumentation rather than the attached agent.

## Options Considered

### Option A: Disable codeless attach

Remove `ApplicationInsightsAgent_EXTENSION_VERSION` from the site configuration so App
Service stops injecting the agent. Both errors disappear at the source. The application
loses nothing it was using, because the agent was declining to attach. The permission
grants that exist only to accommodate the agent — `--allow-fs-read=/agents/` and
`--allow-fs-write=/var/log/` — can then be dropped, which makes the production sandbox
smaller than it was before the agent ever appeared.

### Option B: Restore the blanket `/var` write grant

Change `--allow-fs-write=/var/log/` back to `--allow-fs-write=/var/`. This silences the
status folder error and nothing else; the AAD failure is untouched. It also re-widens
exactly what #704 deliberately narrowed, handing `/var/lib` and `/var/cache` back to a
process that should not be writing to either, so that a component which is not
instrumenting the application can record that it did not instrument the application.

### Option C: Accept the noise

The errors are cosmetic. The container starts, the cache and jobs clients connect, the
worker starts, and the health endpoint answers 200. Nothing is broken. But four
`ERR_ACCESS_DENIED` lines per start train the eye to skip permission errors in this
log, and the next one will be real.

### Option D: Drop the in-process SDK and rely on the agent

Delete `helpers/application-insights.js` and let auto-instrumentation do the work. This
inverts the problem rather than solving it: the agent is the half that is failing on
Node.js 26, and the custom `trackMetric` calls in `server.js`, `helpers/publisher.js`,
and `health/health.controller.js` have no equivalent under codeless attach.

## Decision

Disable codeless attach and keep the in-process SDK.

The SDK is the path the code was written against, the path that carries the custom
metrics, and the path that works. The agent is a second, older copy of the same library,
injected by the platform, which correctly detects the first one and stands down — after
logging two failures on the way.

This is not a rejection of auto-instrumentation in general. It is the recognition that
running both at once buys nothing and costs a log full of permission errors, and that
where the two disagree, the one written in the repository wins.

### Sequencing

The change has an ordering constraint that is easy to get backwards. While the agent is
still injected, `--allow-fs-read=/agents/` is load-bearing. Node exempts the `--require`
preload entry file itself from the read check, but every `require()` the preload makes
afterward is enforced, and an uncaught `ERR_ACCESS_DENIED` inside a preload takes the
process down at bootstrap. Verified on Node.js 26.8.1:

```
$ NODE_OPTIONS="--require /ungranted/loader.cjs" node --permission --allow-fs-read=./app.cjs app.cjs
Error: Access to this API has been restricted. Use --allow-fs-read to manage permissions.
exit=1
```

Removing the grant while App Service still injects the agent would therefore stop the
container from starting. The site configuration changes first; the permission grants
come out afterward.

## Consequences

* `ApplicationInsightsAgent_EXTENSION_VERSION` is removed from the App Service
  configuration. `APPLICATIONINSIGHTS_CONNECTION_STRING` stays — it is read by the
  agent, not by `setup()`, which is passed an instrumentation key explicitly, and
  leaving it costs nothing if auto-instrumentation is ever revisited.
  `APPLICATIONINSIGHTS_AUTHENTICATION_STRING` becomes dead configuration; the
  in-process SDK does not read it.
* `start:production` drops `--allow-fs-read=/agents/` and `--allow-fs-write=/var/log/`.
  Nothing else in the tree writes to `/var/log`: the exporter's offline retry buffer
  lives under `os.tmpdir()`, which the Dockerfile points at `/var/tmp`, and that grant
  stays.
* Telemetry is unchanged, in the narrow sense that the custom metrics were never
  flowing through the agent. It is not a clean bill of health: verifying this decision
  turned up that `destiny-ghost-insights` - the resource named by both the settings
  file and the app setting, instrumentation key `27ad3f7a` - has received no telemetry
  of any kind for at least seven days, custom metrics included. The ingestion service
  answered every upload with `400 Invalid workspace`: the resource is workspace-based,
  its auto-created `DefaultWorkspace-…-SCUS` Log Analytics workspace had been deleted,
  and a component pointing at a deleted workspace has nowhere to store anything. No
  code was at fault and no code fixed it - the component was relinked to a new
  workspace and metrics began landing immediately. It also settles the question this
  ADR could otherwise only infer: had the agent been attaching, that resource would
  hold requests and dependencies right up to the moment it was disabled. It holds
  none, so the agent really was standing down and logging two failures per process on
  its way out.
* Finding that cause took a temporary tracer in `helpers/application-insights.js` that
  logged the ingestion service's reply to each upload. It was removed once the workspace
  was relinked, and the technique is worth recording for whoever needs it next: the SDK
  reads that reply only to decide whether to retry and then discards it, the distro's
  own diagnostics print the status code without the body, and the portal shows an empty
  resource either way. A week of rejected telemetry is indistinguishable from an idle
  week from every angle the platform offers. Wrapping `https.request` and logging the
  body of any non-200 on `/v2.1/track` is what turned that into one line naming the
  cause.
* Live Metrics and automatic dependency tracking are not available. They already were
  not — `setup()` disables auto-collection of requests, performance, and dependencies,
  and the agent was standing down. Turning any of them on is a code change to
  `helpers/application-insights.js`, not a portal toggle.
* If auto-instrumentation is ever wanted, this decision has to be reversed
  deliberately: restore the app setting, restore both grants, and remove the in-process
  `setup()` call so the two paths do not collide again.
* `helpers/permission-model-patch.js` and its spec are deleted, and
  `--import=./helpers/permission-model-patch.js` is gone from `start:production`. The
  shim existed to answer `diagnostic-channel`'s `process.binding('natives')` call, and
  `diagnostic-channel` left the dependency tree when `applicationinsights` went to 3.x
  and became OpenTelemetry-based. Nothing in the tree asks for `'natives'` any more.
  The three remaining `process.binding` callers are unaffected, because the shim threw
  for every name but `'natives'` and the Permission Model throws for all of them:
  `lodash.mergewith` (`'util'`) and `safer-buffer` (`'buffer'`) already catch it, and
  `debug@2`'s `'tty_wrap'` call sits in a Node 0.x code path that has never been
  reached in production - it would have been crashing on the shim's own throw if it
  were.

## References

* [Monitor Azure App Service — Node.js auto-instrumentation](https://learn.microsoft.com/en-us/azure/app-service/monitor-app-service)
* [microsoft/ApplicationInsights-node.js](https://github.com/microsoft/ApplicationInsights-node.js)
* [Node.js Permission Model](https://nodejs.org/api/permissions.html)
* [#704 — narrowed the `/var` write grant](https://github.com/chrispaskvan/destiny-ghost-api/pull/704)
