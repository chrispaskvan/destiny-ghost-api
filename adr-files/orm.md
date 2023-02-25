# Use an Object Relational Mapping (ORM) Library

## Status

Denied.

## Context

ORMs provide a convenient and consistent data layer between the repository layer and underlying databases.

## Decision

The benefits of leveraging an ORM are minor. The SQLite database is used as a read-only data store. Introducing the complexities on an ORM does not provide value.

## Consequences

Interactions with the SQLite database are done using SQL.

## References
*[Why you should avoid ORMs (with examples in Node.js)](https://blog.logrocket.com/why-you-should-avoid-orms-with-examples-in-node-js-e0baab73fa5/)
