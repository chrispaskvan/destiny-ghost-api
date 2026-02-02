# destiny-ghost-api

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Codacy Badge](https://api.codacy.com/project/badge/Grade/eb80d748233e4f0c836a329ddb390be4)](https://app.codacy.com/manual/chrispaskvan/destiny-ghost-api?utm_source=github.com\&utm_medium=referral\&utm_content=chrispaskvan/destiny-ghost-api\&utm_campaign=Badge_Grade_Dashboard)
[![Codacy Badge](https://api.codacy.com/project/badge/Coverage/f3739ef16c3a4c9d9ad08423744fa5d3)](https://www.codacy.com/manual/chrispaskvan/destiny-ghost-api?utm_source=github.com\&utm_medium=referral\&utm_content=chrispaskvan/destiny-ghost-api\&utm_campaign=Badge_Coverage)
[![Maintainability](https://qlty.sh/gh/chrispaskvan/projects/destiny-ghost-api/maintainability.svg)](https://qlty.sh/gh/chrispaskvan/projects/destiny-ghost-api)
[![Known Vulnerabilities](https://snyk.io/test/github/chrispaskvan/destiny-ghost-api/badge.svg)](https://snyk.io/test/github/chrispaskvan/destiny-ghost-api)
[![Dependency Status](https://img.shields.io/librariesio/github/chrispaskvan/destiny-ghost-api)](https://libraries.io/github/chrispaskvan/destiny-ghost-api)

Node application for SMS/MMS interface for receiving notifications of Vendor (Xur) inventory changes and on-demand weapon searches.

## Description

This project provides a quick and convenient way to search the Destiny database through text messages. Guardians can message the name of that mysterious weapon that just killed them in PvP (Player versus Player) for more insight. For example, "Thorn" returns "Thorn Exotic Primary Hand Cannon". The service can also notify guardians of sale items when vendors refresh their stock. So when Xur finally sells that Gjallarhorn you've been dying for, you don't miss it.

## Disclaimer

This project is not affiliated with, maintained, authorized, endorsed, or sponsored by Bungie.

## To Do List

See my grandious plans for the future [here](ToDo.md).

## Background

In the fall of 2007, I was introduced to Halo 3. I immediately fell in love with the game. Perhaps my greatest achievement as a gamer was completing the campaign on Legendary difficulty. Bungie moved on from Halo and released Destiny in the fall of 2014.

Destiny had its share of shortcomings from the beginning. Regardless, my imagination was captured by the creative ways the Destiny community found to fill the gaps. Players develeoped and shared apps for managing inventory, finding Public Events, and looking for a group (LFG). What made these apps possible was Bungie's public Destiny Application Programming Interface (API).

From a business perspective, I found the decision by Bungie to share an API with the player community fascinating. Bungie got to see what features the community wanted from observing the popularity of these apps. More often than not, Bungie would eventually incorporate many of these features into Destiny themselves.

As a developer and a gamer, I wanted a fun portfolio project. At the time when I started, I was impressed with Twilio's developer experience for programmable SMS (Short Message Service). I came up with this application for receiving SMS messages to important Destiny events like "Xur is selling the Gjallarhorn" and a way to search the Destiny database through SMS. With this project, I like to try new things, apply what I've learned, and ask my phone after I get one-shotted by another player in the Crucible, "What f'ing gun was that‽"

## Software Design

I'm a huge fan of learning new [architecture patterns](https://github.com/nodeshift/nodejs-reference-architecture), following [best practices](https://github.com/goldbergyoni/nodebestpractices), and [testing methodologies](https://github.com/testjavascript/nodejs-integration-tests-best-practices). Below are some of the design patterns and best practices I've incorporated into this project.

### Frameworks

- Express.js 5.x:
    - More than a decade ago I started with Express.js 4.x. Given the scale of this project, I didn't want an opinionated framework and the community support was mature. I recently upgraded to the new major release of Express.js 5.x.
- Vitest.js for testing:
    - I migrated away from Jest. I wanted to use ESM (ECMAScript Modules) and Jest doesn't support them. See this [Architecture Decision Recored (ADR)](adr-files/esm.md) for more information.
- ESLint:
    - Linters are great when it comes to recommending [code quality and style patterns](https://github.com/goldbergyoni/nodebestpractices?tab=readme-ov-file#3-code-patterns-and-style-practices). 
- BullMQ for pub/sub messaging:
    - I also wanted to learn more about cloud computing when I started. I originally used Azure Service Bus for messaging. But I've since migrated to BullMQ for pub/sub messaging as a cost saving measure, since I'm already using Redis for caching.
- Pino for logging:
    - Consistent logging is so crucial. I chose Pino because it's fast and has a low memory footprint. I also like the JSON output format.
- Twilio for SMS/MMS:
    - Twilio is known for its developer experience. They became the leader in programmable SMS/MMS by putting the developer first. Another fascinating business model.

### Security

- Secure HTTP headers with Helmet:
    - I want my application to be production ready, which includes making it secure.
- Rate limits:
    - To prevent abuse of the API, I implelemented rate limiting to manage incoming requests.
- Data validation and schema definitions:
    - I used Joi for data validation and schema definitions.
- Body parser limits:
    - I set limits on incoming payloads to prevent abuse.

### Design Patterns

- Graceful shutdown:
    - I've seen Kubernetes kill applications when readiness and/or liveness probes fail. I wanted to make sure I was handling shutdowns gracefully. I use GoDaddy's Terminus and some Docker best practices to shutdown application resources gracefully.
- Cache-Aside caching strategy:
    - The Desiny API has rate limits too. I'm efficiently caching data to prevent hitting those limits.
- JSON Patch:
    - I'm not a fan of PUT requests. I am a fan of PATCH requests, partticularly [JSON Patch](https://jsonpatch.me). I appreciate how the standard is explicit about what is being updated.
- Health checks and metrics:
    - In today's cloud environment, health checks and metrics are critical when it comes to observability.
- ESM support:
    - I like to keep up with the latest and greatest features in JavaScript.
- API documentation with Swagger:
    - OpenAPI is a great way to document APIs.
- Test suites - unit, integration, and end-to-end:
    - There a lot of ways to test software. I like to use a smart combination of each.
- Observability headers:
    - I support using the X-Request-Id and X-Trace-Id headers for observability. I plan to use OpenTelemetry for distributed tracing.
- Performance hooks for capturing latency of external services:
    - This service relies on external services. I want to make sure I have observability into the latency of those services.
- HTTP request streaming and paginated responses for fetching inventory:
    - I wanted an example of how to stream data from an API and paginate the results.
- GRPC server for fetching inventory data:
    - I wanted to learn more about GRPC and how to define service contracts in a Node.js application.
- Asynchronous notification API:
    - Sending notifications to a list of subscribers can take time. I created an asynchronous API with support for idempotency and claim checks to handle the task with throttling in place.
- GraphQL Gateway:
    - I added a GraphQL endpoint as a gateway to query data from both Bungie's API and mine.
- Optimistic Locking:
    - The patch user endpoint leverages optimistic locking to prevent colliding updates to a user's profile.

## References

https://bungie-net.github.io/
