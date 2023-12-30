# Codacy Code Coverage

## Status

Accepted.

## Context

I've been wanting to experiment with stored procedures in Azure's Cosmos DB. Deleting documents in Cosmos DB cannot be done through the portal. I've always been a fan of running functional code closer to the metal with native SQL Stored Procedures given the right circumstances.

## Decision

I found stored procedures in Cosmos to be clunky. Despite having recently added support for asnyc/await, you still get caught up in callback hell. Given my use case, I decided it was more sustainable to use code in the service layer than code that lives in the database.

## Consequences

The performance of a stored procedure running on the database should be better than fetching and deleting documents using HTTP communication protocol via the client .

## References
* [Error using the action](https://github.com/codacy/codacy-coverage-reporter-action/issues/8)
* [Codacy Coverage Reporter](https://github.com/codacy/codacy-coverage-reporter)
