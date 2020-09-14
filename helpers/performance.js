const asyncHooks = require('async_hooks');
const {
    performance,
    PerformanceObserver,
} = require('perf_hooks');

const log = require('./log');

const trackedResources = new Map();
const hook = asyncHooks.createHook({
    init(id, type, triggerID, resource) {
        if (['GETADDRINFOREQWRAP', 'HTTPCLIENTREQUEST'].includes(type)) {
            performance.mark(`gjallarhorn-${id}-init`);
            trackedResources.set(id, type === 'GETADDRINFOREQWRAP'
                ? `DNS Lookup: ${resource.hostname}`
                : `HTTP Request: ${resource.req.method} ${resource.req.connection._host}${resource.req.path}`); // eslint-disable-line no-underscore-dangle
        }
    },
    destroy(id) {
        if (trackedResources.has(id)) {
            const context = trackedResources.get(id);

            trackedResources.delete(id);
            performance.mark(`gjallarhorn-${id}-destroy`);
            performance.measure(context,
                `gjallarhorn-${id}-init`,
                `gjallarhorn-${id}-destroy`);
        }
    },
});

const obs = new PerformanceObserver(list => {
    const entry = list.getEntries()[0];

    log.info(`${entry.name}: ${entry.duration}`);
});

obs.observe({ entryTypes: ['measure'], buffered: false });

module.exports = hook;
