# Swagger Integration

## Status

Accepted.

## Context

When applying Docker best practices and using the Node user rather than root, the automated Swagger JSON generation by the swagger-jsdoc library causes the following failure when running the container.

> EPERM: operation not permitted, scandir

## Decision

Use swagger-jsdoc cli and add a npm script to generate the swagger.json file.

## Consequences

The swagger.json file is not generated automatically. The npm script "swagger" must be executed and the file committed.

## References
* [Swagger - Basic Structure](https://swagger.io/docs/specification/basic-structure/)
