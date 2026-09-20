# destiny-ghost-api

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/chrispaskvan/destiny-ghost-api/actions/workflows/ci.yml/badge.svg)](https://github.com/chrispaskvan/destiny-ghost-api/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-26.x-green?logo=node.js)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-orange?logo=pnpm)](https://pnpm.io)
[![Biome](https://img.shields.io/badge/Lint%2FFormat-Biome-60A5FA?logo=biome)](https://biomejs.dev)
[![Codacy Badge](https://api.codacy.com/project/badge/Grade/eb80d748233e4f0c836a329ddb390be4)](https://app.codacy.com/manual/chrispaskvan/destiny-ghost-api?utm_source=github.com\&utm_medium=referral\&utm_content=chrispaskvan/destiny-ghost-api\&utm_campaign=Badge_Grade_Dashboard)
[![Codacy Badge](https://api.codacy.com/project/badge/Coverage/f3739ef16c3a4c9d9ad08423744fa5d3)](https://www.codacy.com/manual/chrispaskvan/destiny-ghost-api?utm_source=github.com\&utm_medium=referral\&utm_content=chrispaskvan/destiny-ghost-api\&utm_campaign=Badge_Coverage)
[![Maintainability](https://qlty.sh/gh/chrispaskvan/projects/destiny-ghost-api/maintainability.svg)](https://qlty.sh/gh/chrispaskvan/projects/destiny-ghost-api)
[![Dependency Status](https://img.shields.io/librariesio/github/chrispaskvan/destiny-ghost-api)](https://libraries.io/github/chrispaskvan/destiny-ghost-api)
![MCP Protocol](https://img.shields.io/badge/MCP-Supported-orange?logo=anthropic)

Node application for SMS/MMS interface for receiving notifications of Vendor (Xur) inventory changes and on-demand weapon searches.

## Description

This project provides a quick and convenient way to search the Destiny database through text messages. Guardians can message the name of that mysterious weapon that just killed them in PvP (Player versus Player) for more insight. For example, "Thorn" returns "Thorn Exotic Primary Hand Cannon". The service can also notify guardians of sale items when vendors refresh their stock. So when Xur finally sells that Gjallarhorn you've been dying for, you don't miss it.

## Development Setup

This repository targets Node.js 26 and the Docker image is pinned to Node.js 26.7.0. For local development, run `nvm use` from the repository root to activate the version declared in `.nvmrc` before installing dependencies or running scripts.

## Disclaimer

This project is not affiliated with, maintained, authorized, endorsed, or sponsored by Bungie.

## To Do List

See my grandious plans for the future [here](ToDo.md).

## API Flows

See [DIAGRAM.md](DIAGRAM.md) for sequence diagrams of the auth, registration, and authenticated app-usage flows a frontend should build around.

## Background

In the fall of 2007, I was introduced to Halo 3. I immediately fell in love with the game. Perhaps my greatest achievement as a gamer was completing the campaign on Legendary difficulty. Bungie moved on from Halo and released Destiny in the fall of 2014.

Destiny had its share of shortcomings from the beginning. Regardless, my imagination was captured by the creative ways the Destiny community found to fill the gaps. Players develeoped and shared apps for managing inventory, finding Public Events, and looking for a group (LFG). What made these apps possible was Bungie's public Destiny Application Programming Interface (API).

From a business perspective, I found the decision by Bungie to share an API with the player community fascinating. Bungie got to see what features the community wanted from observing the popularity of these apps. More often than not, Bungie would eventually incorporate many of these features into Destiny themselves.

As a developer and a gamer, I wanted a fun portfolio project. At the time when I started, I was impressed with Twilio's developer experience for programmable SMS (Short Message Service). I came up with this application for receiving SMS messages to important Destiny events like "Xur is selling the Gjallarhorn" and a way to search the Destiny database through SMS. With this project, I like to try new things, apply what I've learned, and ask my phone after I get one-shotted by another player in the Crucible, "What f'ing gun was that‽"

## Software Design

I'm a huge fan of learning new [architecture patterns](https://github.com/nodeshift/nodejs-reference-architecture), following [best practices](https://github.com/goldbergyoni/nodebestpractices), and [testing methodologies](https://github.com/testjavascript/nodejs-integration-tests-best-practices). Below are some of the design patterns and best practices I've incorporated into this project.

### Frameworks

* Express.js 5.x:
  * More than a decade ago I started with Express.js 4.x. Given the scale of this project, I didn't want an opinionated framework and the community support was mature. I recently upgraded to the new major release of Express.js 5.x.
* Vitest.js for testing:
  * I migrated away from Jest. I wanted to use ESM (ECMAScript Modules) and Jest doesn't support them. See this [Architecture Decision Record (ADR)](adr-files/esm.md) for more information.
* Biome for linting and formatting:
  * Linters are great when it comes to recommending [code quality and style patterns](https://github.com/goldbergyoni/nodebestpractices?tab=readme-ov-file#3-code-patterns-and-style-practices). I migrated from ESLint to Biome for its speed and unified lint + format toolchain.
* BullMQ for pub/sub messaging:
  * I also wanted to learn more about cloud computing when I started. I originally used Azure Service Bus for messaging. But I've since migrated to BullMQ for pub/sub messaging as a cost saving measure, since I'm already using Redis for caching.
* Pino for logging:
  * Consistent logging is so crucial. I chose Pino because it's fast and has a low memory footprint. I also like the JSON output format.
* Twilio for SMS/MMS:
  * Twilio is known for its developer experience. They became the leader in programmable SMS/MMS by putting the developer first. Another fascinating business model.

### Security

* Secure HTTP headers with Helmet:
  * I want my application to be production ready, which includes making it secure.
* Rate limits:
  * To prevent abuse of the API, I implemented rate limiting to manage incoming requests.
  * Twilio inbound, delivery-callback, and fallback traffic have independent ingress budgets of 1,000 requests/second per IP. Verified inbound senders have a separate 20 commands/minute budget; excess commands receive HTTP 200 with empty TwiML, without executing the command or sending an SMS reply. STOP/HELP/START and their aliases bypass the command quota, but not ingress protection. These initial limits should be tuned against observed webhook bursts and retries; disconnected Redis limiters fail open without queueing commands.
  * Missing, empty, or non-string signature headers are rejected before body parsing; non-empty strings are verified by Twilio's SDK on inbound, callback, and fallback routes without an application-level format regex. Failed signatures and unsafe parameter shapes share a separate 10-failures/second IP budget; subsequent requests from an exhausted IP are rejected before parsing and HMAC work. These authentication rejections return HTTP 403 without rate-limit counters, including when that budget is exhausted. Already-in-flight requests can still finish verification. Webhook JSON/form parsers cap bodies at 32 KiB, instead of the API's 1 MiB. These are application safeguards, not a replacement for edge-level traffic controls. Twilio does not publish a fixed webhook IP range, so source IPs are not treated as authentication.
  * Ingress overload still returns HTTP 429. Callbacks are acknowledged only after processing, never silently discarded to avoid retries. Retry behavior depends on Twilio's configured webhook policy. Unmatched Twilio paths receive an ingress-limited 404 only after passing preflight (a non-empty signature header and an unexhausted failure budget); otherwise preflight returns 403. Neither path consumes the browser/API quota. Only supported webhook routes perform SDK signature verification.
  * Request tracing and access logging run before preflight, body parsing, and session loading, so early rejections receive correlation headers and structured logs. Request-received logs at this stage do not have parsed body or session identity fields.
  * Webhooks skip browser-session loading and its availability guard, including requests carrying old session cookies. Consent and onboarding do not require Bungie credentials; Xur requests validate credentials at the point of use. User-service cache reads/writes still depend on Redis, so bypassing sessions does not guarantee full SMS functionality during a Redis outage.
  * STOP/START replies do not wait for user lookup or persistence. A best-effort background operation skips unchanged subscription state and logs lookup/write failures; HELP does not look up a user at all. Genuine changes are attempted, but a persistence failure or process termination can leave stored consent unchanged. This protects reply availability, not durable consent delivery or write ordering.
* Data validation and schema definitions:
  * I used Zod for data validation and schema definitions.
* Body parser limits:
  * I set limits on incoming payloads to prevent abuse.

### Design Patterns

* Graceful shutdown:
  * I've seen Kubernetes kill applications when readiness and/or liveness probes fail. I wanted to make sure I was handling shutdowns gracefully. I use GoDaddy's Terminus and some Docker best practices to shutdown application resources gracefully.
* Cache-Aside caching strategy:
  * The Destiny API has rate limits too. I'm efficiently caching data to prevent hitting those limits.
* JSON Patch:
  * I'm not a fan of PUT requests. I am a fan of PATCH requests, particularly [JSON Patch](https://jsonpatch.me). I appreciate how the standard is explicit about what is being updated.
* Health checks and metrics:
  * In today's cloud environment, health checks and metrics are critical when it comes to observability.
* ESM support:
  * I like to keep up with the latest and greatest features in JavaScript.
* API documentation with Swagger:
  * OpenAPI is a great way to document APIs.
* Test suites - unit, integration, and end-to-end:
  * There are a lot of ways to test software. I like to use a smart combination of each.
* Observability headers:
  * I support using the X-Request-Id and X-Trace-Id headers for observability. I plan to use OpenTelemetry for distributed tracing.
* Performance hooks for capturing latency of external services:
  * This service relies on external services. I want to make sure I have observability into the latency of those services.
* HTTP request streaming and paginated responses for fetching inventory:
  * I wanted an example of how to stream data from an API and paginate the results.
* GRPC server for fetching inventory data:
  * I wanted to learn more about GRPC and how to define service contracts in a Node.js application.
* Asynchronous notification API:
  * Sending notifications to a list of subscribers can take time. I created an asynchronous API with support for idempotency and claim checks to handle the task with throttling in place.
* GraphQL Gateway:
  * I added a GraphQL endpoint as a gateway to query data from both Bungie's API and mine.
* Optimistic Locking:
  * The patch user endpoint leverages optimistic locking to prevent colliding updates to a user's profile.

## References

https://bungie-net.github.io/
