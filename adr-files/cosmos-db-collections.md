# Cosmos DB Collections

## Status

Accepted.

## Context

Rather than maintain a log of incoming and out going messages within the user document, record messages in a separate collection.

## Decision

The user document grows in size when adding messages. This has a negative affect on the performance of user look ups. Messages are needed for audit purposes only. Maintaining a separate collection allows reporting functions to continue without adding to the size of the user document.

## Consequences

Finding the history of messages by membership Id requires querying the collection by phone number. The performance will be poorer since the collection contains messages for all users. Since this query is for administrative purposes, and is not needed for primary user functions, the sacrifice is deemed acceptable.
