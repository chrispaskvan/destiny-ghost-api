/**
 * A module for importing the Application Insights client.
 *
 * @module application-insights
 * @author Chris Paskvan
 * @requires applicationinsights
 */
import applicationInsights from 'applicationinsights';
import configuration from './config';

const { applicationInsights: { instrumentationKey } } = configuration;
// eslint-disable-next-line import/no-mutable-exports
let client;

if (process.env.NODE_ENV === 'production') {
    applicationInsights.setup(instrumentationKey).start();
    client = applicationInsights.defaultClient;
} else {
    // eslint-disable-next-line no-import-assign
    client = {
        trackMetric: () => undefined,
    };
}

export default client;
