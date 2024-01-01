# Stored Procedures in Cosmos DB

## Status

Accepted.

## Context

I've been wanting to experiment with stored procedures in Azure's Cosmos DB. Deleting documents in Cosmos DB cannot be done through the portal. I've always been a fan of running functional code closer to the metal with native SQL Stored Procedures given the right circumstances.

## Decision

I found stored procedures in Cosmos to be clunky. Despite having recently added support for asnyc/await, you still get caught up in callback hell. Given my use case, I decided it was more sustainable to use code in the service layer than code that runs closer to the bare metal of the database.

## Consequences

The performance of a stored procedure running on the database should be better than fetching and deleting documents using HTTP communication protocol via the client .

## References
  * [How to write stored procedures and triggers in Azure Cosmos DB by using the JavaScript query API](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/how-to-write-javascript-query-api)
