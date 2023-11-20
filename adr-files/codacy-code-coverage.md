# Codacy Code Coverage

## Status

Accepted.

## Context

In order to integrate code coverage with Codacy, Jest had to be configured to include the 'clover' coverage reporter and the resultant file copied to the path './coverage-xml/cobertura.xml' in order to be recognized.

## Decision

The coverage file 'clover.xml' must be copied manually and commited. The decision was made not to add any additional automation at this time.

## Consequences

In order to update the code coverage reported by Codacy, the required file must be updated.

## References
* [Error using the action](https://github.com/codacy/codacy-coverage-reporter-action/issues/8)
* [Codacy Coverage Reporter](https://github.com/codacy/codacy-coverage-reporter)
