// @ts-check
import { createHook } from 'node:async_hooks';
import { performance, PerformanceObserver } from 'node:perf_hooks';

import log from './log.js';

const trackedResources = new Map();
const hook = createHook({
    init(id, type, _triggerID, resource) {
        if (['GETADDRINFOREQWRAP', 'HTTPCLIENTREQUEST'].includes(type)) {
            /**
             * Node types `resource` as a bare `object` since its shape is an
             * undocumented internal AsyncResource specific to each `type`.
             * @type {any}
             */
            const internalResource = resource;

            performance.mark(`gjallarhorn-${id}-init`);
            trackedResources.set(
                id,
                type === 'GETADDRINFOREQWRAP'
                    ? `DNS Lookup: ${internalResource.hostname}`
                    : `HTTP Request: ${internalResource.req.method} ${internalResource.req.connection._host}${internalResource.req.path}`,
            );
        }
    },
    destroy(id) {
        if (trackedResources.has(id)) {
            const context = trackedResources.get(id);

            trackedResources.delete(id);
            performance.mark(`gjallarhorn-${id}-destroy`);
            performance.measure(context, `gjallarhorn-${id}-init`, `gjallarhorn-${id}-destroy`);
        }
    },
});

const obs = new PerformanceObserver(list => {
    const entries = list.getEntries()[0];
    const { duration, name: entry } = entries;

    log.info(
        {
            entry,
            duration: Math.round(duration * 1000) / 1000,
        },
        'Performance Measurement',
    );
});

obs.observe({ entryTypes: ['measure'], buffered: false });

export default hook;
