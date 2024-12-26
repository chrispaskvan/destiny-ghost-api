# To Do List

## User Interface

The application needs a user interface to allow users to register, login, and manage their subscriptions. Plan on using React. Add a UI testing framework like Cypress or Playwright.

The web application also needs to have a public page that provides a clear and comprehensive overview of the campaign's objectives and interactions the end-user would experience after opting in. For more details about the Campaign Approval Best Practices, see [here](https://support.twilio.com/hc/en-us/articles/11847054539547-A2P-10DLC-Campaign-Approval-Best-Practices).

### Bonuses

The user interface should be a Progressive Web Application (PWA) that can be installed on a user's device.

The user interface could provide a billing report for the user.

Segregate the user interface from the API to allow for independent scaling.

## Performance Testing

More performance tests should be added to the application to identify bottlenecks.

### Resources
- [Node Clinic](https://github.com/nearform/node-clinic)
- [Artillery](https://www.artillery.io)

## Notifications

The application could maintain a list of subscribers to notify for each vendor rather than querying for subscribed users in the user collection.
- Save an array of subscribed phone numbers to the vendor in the Notifications collection.
- Emit an event to notify the Notification class to add a subscriber.
- Fetch subscribers from the Notification collection when it is time to send a message.
- Add a utility for synchronizing the list of phone numbers subscibed to the vendor with the source of truth User collection as a fallback in case of failures.

## Telemetry

The application has been instrumented with Application Insights, but custom telemetry data could be added to provide more insights into the application's performance.

### Bonuses

- Evaluate how to capture application metrics like Node performace.
- Consider OpenTelemetry for distributed tracing.

## Circuit Breaker

Bungie's API is a external dependency that could be unreliable. Implement a circuit breaker to prevent the application from making requests to the API when it is down.

## Manifest Refresh

Add a timer to automatically refresh the manifest file when Bungie releases a new version.

## Rich Communication Services (RCS)

The application could be enhanced to use RCS to provide a richer experience for users. RCS is a messaging protocol that allows for more interactive messaging experiences. For example, a user could receive a message with a carousel of images of the players in a fireteam. See [How to send an RCS message with Twilio and Node.js](https://www.twilio.com/en-us/blog/getting-started-with-rcs-node) for more information.

## Challenges

Messages are saved to the database based on the Twilio data schema captured by the service through the web hook. When a user sends a message to the service, in converse with receiving a message from the service, the phone number the message is directed to, and identified in the data, is the Twilio messaging service's, not the user's. Therefore, the service cannot determine how many messages a user has sent to the service. The service can only determine how many messages the user has received from the service. This is a challenge because the service needs to bill users based on both the number of messages they send to the service and the number of messages received from the service.

## AI

I'd like to explore the possibility of using AI to drive a feature that uses text recognition from an image to determine players in a fireteam. A user could send a screenshot of the players in the lobby before the start of a match and receive a report from the service with the players' stats in order to highlight strong players over weak ones.
