/**
 * A module for importing the Application Insights client.
 *
 * @module application-insights
 * @author Chris Paskvan
 * @requires applicationinsights
 */
const applicationInsights = require('applicationinsights');
const { applicationInsights: { instrumentationKey } } = require('./config');

if (process.env.NODE_ENV === 'production') {
    applicationInsights.setup(instrumentationKey).start();
} else {
    applicationInsights.defaultClient = {
        trackMetric: () => undefined,
    };
}

module.exports = applicationInsights.defaultClient;
