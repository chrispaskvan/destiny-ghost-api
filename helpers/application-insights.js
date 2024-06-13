/**
 * A module for importing the Application Insights client.
 *
 * @module application-insights
 * @author Chris Paskvan
 * @requires applicationinsights
 * @see {@link https://github.com/microsoft/ApplicationInsights-node.js?tab=readme-ov-file#configuration}
 */
import applicationInsights from 'applicationinsights';
import configuration from './config';

const { applicationInsights: { instrumentationKey } } = configuration;
const setupTelemetryClient = () => {
    if (process.env.NODE_ENV !== 'production') {
        return {
            trackMetric: () => undefined,
        };
    }

    applicationInsights.setup(instrumentationKey)
        .setAutoCollectRequests(false)
        .setAutoCollectPerformance(false, false)
        .setAutoCollectDependencies(false);
    applicationInsights.start();

    return applicationInsights.defaultClient;
};
const client = setupTelemetryClient();

export default client;
