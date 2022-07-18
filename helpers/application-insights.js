/**
 * A module for importing the Application Insights client.
 *
 * @module application-insights
 * @author Chris Paskvan
 * @requires applicationinsights
 */
import { setup, defaultClient } from 'applicationinsights';
import configuration from './config';

const { applicationInsights: { instrumentationKey } } = configuration;
// eslint-disable-next-line import/no-mutable-exports
let client;

if (process.env.NODE_ENV === 'production') {
    setup(instrumentationKey).start();
    client = defaultClient;
} else {
    // eslint-disable-next-line no-import-assign
    client = {
        trackMetric: () => undefined,
    };
}

export default client;
