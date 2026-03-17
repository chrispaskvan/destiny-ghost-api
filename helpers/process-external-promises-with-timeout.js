async function processExternalPromisesWithTimeout(externalPromises, timeout) {
    const controller = new AbortController();
    const { signal } = controller;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const results = await Promise.allSettled(
            externalPromises.map(async externalPromise => {
                return new Promise((resolve, reject) => {
                    Promise.race([
                        externalPromise,
                        new Promise((_, rj) => signal.addEventListener(
                            'abort',
                            () => rj(new Error('Promise timed out')),
                            { once: true },
                        )),
                    ]).then(resolve, reject);
                });
            })
        );

        return results.map(r => {
            if (r.status === 'fulfilled') {
                return { status: 'fulfilled', value: r.value };
            }

            if (r.reason?.message === 'Promise timed out') {
                return { status: 'timed-out' };
            }

            return { status: 'rejected', reason: r.reason };
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

export default processExternalPromisesWithTimeout;
