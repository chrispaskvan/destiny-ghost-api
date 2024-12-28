# destiny-ghost-api

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Codacy Badge](https://api.codacy.com/project/badge/Grade/eb80d748233e4f0c836a329ddb390be4)](https://app.codacy.com/manual/chrispaskvan/destiny-ghost-api?utm_source=github.com\&utm_medium=referral\&utm_content=chrispaskvan/destiny-ghost-api\&utm_campaign=Badge_Grade_Dashboard)
[![Codacy Badge](https://api.codacy.com/project/badge/Coverage/f3739ef16c3a4c9d9ad08423744fa5d3)](https://www.codacy.com/manual/chrispaskvan/destiny-ghost-api?utm_source=github.com\&utm_medium=referral\&utm_content=chrispaskvan/destiny-ghost-api\&utm_campaign=Badge_Coverage)
[![Maintainability](https://api.codeclimate.com/v1/badges/da028fbc47cd8718e45b/maintainability)](https://codeclimate.com/github/chrispaskvan/destiny-ghost-api/maintainability)
[![Known Vulnerabilities](https://snyk.io/test/github/chrispaskvan/destiny-ghost-api/badge.svg)](https://snyk.io/test/github/chrispaskvan/destiny-ghost-api)
[![Dependency Status](https://img.shields.io/librariesio/github/chrispaskvan/destiny-ghost-api)](https://libraries.io/github/chrispaskvan/destiny-ghost-api)

Node application for SMS/MMS interface for receiving notifications of Vendor (Xur) inventory changes and on-demand weapon searches.

## Description

This project provides a quick and convenient way to query the Destiny database through text messages. The primary function allows guardians to message the name of the mysterious weapon that just struck them down in PvP (Player versus Player) for more information. For example, "Thorn" returns "Thorn Exotic Primary Hand Cannon". The service can also notify guardians, who may not log onto Destiny on a regular basis, updates as to what items come up for sale when vendors refresh their stock. So when Xur finally sells that Gjallarhorn you've been dying for, you don't miss it.

## Disclaimer

This project is not affiliated with, maintained, authorized, endorsed, or sponsored by Bungie.

## Background

In the fall of 2007, I was introduced to Halo 3. I immediately fell in love with the game. Perhaps my greatest achievement as a gamer was completing the campaign on Legendary difficulty. Bungie moved on from Halo and released Destiny in the fall of 2014.

Destiny had its share of shortcomings from the beginning. Despite that, my imagination was captured by how the Destiny community found ways to fill the gaps. Developers shared apps for managing inventory, finding Public Events, and looking for a group (LFG). And what made these apps possible was Bungie's public Destiny API.

From a business perspective, I found this fascinating. By offering a public API, Bungie got to see what features the community wanted. Sometimes Bungie incorporated these features. And other times, Bungie embraced these 3rd party apps.

As a developer and a gamer, I wanted a fun portfolio project. At the time when I started, I was impressed with the Twilio's developer experience for programmable SMS (Short Message Service). So I came up with an application for receiving SMS messages for important Destiny events like "What is Xur selling today?" and a way to query the Destiny database through SMS. With this project, I like to try new things, apply what I've learned, and ask my phone after I get one-shotted in the Crucible, "What gun was that‽"

## Software Architecture

### Frameworks
- Express.js 5.x
- Vitest.js for testing
- ESLint
- BullMQ for pub/sub messaging
- Pino for logging
- Twilio for SMS/MMS

### Security
- Secure HTTP response headers with Helmet
- Rate limits
- Data validation and schema definitions
- Body parser limits

### Design Patterns
- Graceful shutdown
- Caching strategies
- JSON PAtch
- Health checks and metrics
- ESM support
- API documentation with Swagger
- Test suites: unit, integration, and end-to-end

### Featured Architectures
- Observability from request and trace headers integrated with logs
- Performance hooks for capturing latency of external services
- HTTP request streaming and paginated responses for fetching inventory
- GRPC server for fetching inventory data
- Asynchronous notification API with idempotency and claim checks. Throttling is in place to prevent abuse.
- GraphQL: The API supports GraphQL queries
- Optimistic Locking: The patch user endpoint leverages optimistic locking to prevent colliding updates to a user's profile.

### Best Practices

- https://github.com/nodeshift/nodejs-reference-architecture
- https://github.com/testjavascript/nodejs-integration-tests-best-practices
- https://github.com/goldbergyoni/nodebestpractices

## References

https://bungie-net.github.io/
