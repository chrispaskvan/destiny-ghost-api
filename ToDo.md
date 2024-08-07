# To Do List

## User Interfaces

-https://material-ui.com/store/items/onepirate/
-https://github.com/expressjs/vhost
-https://www.hacksparrow.com/webdev/express/vhost.html

## Coverage Ratchet

## Performance Testing

-https://github.com/nearform/node-clinic

## CosmosDB Stored Procedure for Removing Intermediate Message Statuses

## Notifications

-Save array of subscriber phone numbers to the Notifications collection.
-Emit an event to notify the class to add a subscriber.
-Fetch subscribers from the Notification collection.
-Add a utility end point for synchronization in case of failures.

## File Structure

-https://softwareontheroad.com/ideal-nodejs-project-structure
-https://github.com/santiq/bulletproof-nodejs

## Local SSL Certificate

-https://github.com/FiloSottile/mkcert
-https://stackoverflow.com/questions/21397809/create-a-trusted-self-signed-ssl-cert-for-localhost-for-use-with-express-node

Health versus Metrics
OpenTelemetry
Circuit Breaker

New User Workflow w/Intergration Tests
User Interface

Docker Compose file for CI Testing
Improve Use of Application Insights

CRON job to refresh manifest

[Testing the dark scenarios of your Node.js application](https://practica.dev/blog/testing-the-dark-scenarios-of-your-nodejs-application/)
[The EventSource interface is web content's interface to server-sent events.](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
[Testing Automation, What are Pyramids and Diamonds?](https://ritesh-kapoor.medium.com/testing-automation-what-are-pyramids-and-diamonds-67494fec7c55)

Call /v1/notifications
Playwright?
Local copy of Cosmos DB in Docker
Docker of wiremock
Replace ServiceBus with BullMQ?
Install Circuit Breaker
Cross Save Capabilities

Problem Statement:
Messages are saved to the database based on the Twilio data schema captured by the service through the web hook. When a user sends a message to the service, in converse with receiving a message from the service, the phone number the message is directed to, and identified in the data, is the Twilio messaging service's, not the user's.

Billing per User Report

* Nice to add an index to the /From path on the Messages container.

bullmq
api/app folders
react
tensorflow