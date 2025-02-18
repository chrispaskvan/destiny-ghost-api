import { createHook } from 'node:async_hooks';
import { performance, PerformanceObserver } from 'node:perf_hooks';

import log from './log';

const trackedResources = new Map();
const hook = createHook({
    init(id, type, triggerID, resource) {
        if (['GETADDRINFOREQWRAP', 'HTTPCLIENTREQUEST'].includes(type)) {
            performance.mark(`gjallarhorn-${id}-init`);
            trackedResources.set(id, type === 'GETADDRINFOREQWRAP'
                ? `DNS Lookup: ${resource.hostname}`
                : `HTTP Request: ${resource.req.method} ${resource.req.connection._host}${resource.req.path}`);
        }
    },
    destroy(id) {
        if (trackedResources.has(id)) {
            const context = trackedResources.get(id);

            trackedResources.delete(id);
            performance.mark(`gjallarhorn-${id}-destroy`);
            performance.measure(
                context,
                `gjallarhorn-${id}-init`,
                `gjallarhorn-${id}-destroy`,
            );
        }
    },
});

const obs = new PerformanceObserver(list => {
    const entries = list.getEntries()[0];
    const { duration, name: entry } = entries;

    log.info({
        entry,
        duration: Math.round(duration * 1000) / 1000,
    }, 'Performance Measurement');
});

obs.observe({ entryTypes: ['measure'], buffered: false });

export default hook;
