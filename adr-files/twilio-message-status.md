# Twilio Message Status

## Status

Accepted.

## Context

Twilio invokes a callback with the status of the message. The callback includes the status of delivery. The order in which the callback endpoint processes the request may not follow the expected progression of status values.

## Decision

Rather than upserting the status sent to the callback, persist every status sent. It is too much overhead to check if the callback has been invoked for the same SmsSid. It is also too much overhead to add logic to try to force the order based on the known progression defined by Twilio.

## Consequences

Storage in the database will grow 3 times more since all statuses are persisted instead of only the final status. A separate process can run on a schedule to clean out intermediate statuses. Unique key on SmsSid cannot be used.

## References
* [What are the Possible SMS and MMS Message Statuses, and What do They Mean?](https://support.twilio.com/hc/en-us/articles/223134347-What-are-the-Possible-SMS-and-MMS-Message-Statuses-and-What-do-They-Mean-)
* [@azure/cosmos package](https://docs.microsoft.com/en-us/javascript/api/@azure/cosmos/?view=azure-node-latest)
* [Tutorial: Build a Node.js console app with the JavaScript SDK to manage Azure Cosmos DB SQL API data](https://docs.microsoft.com/en-us/azure/cosmos-db/sql-api-nodejs-get-started)
