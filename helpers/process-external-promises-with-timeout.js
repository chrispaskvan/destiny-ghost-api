async function processExternalPromisesWithTimeout(externalPromises, timeout) {
    const signal = AbortSignal.timeout(timeout);

    const results = await Promise.allSettled(
        externalPromises.map(async externalPromise => {
            return new Promise((resolve, reject) => {
                Promise.race([
                    externalPromise,
                    new Promise((_, rj) => signal.addEventListener('abort', () => rj(new Error('Promise timed out')))),
                ]).then(resolve, reject);
            });
        })
    );

    const hasTimedOut = results.some(r => r.status === 'rejected' && r.reason?.message === 'Promise timed out');

    if (hasTimedOut) {
        console.error('At least one external promise timed out');
    }

    const errors = results
        .filter(r => r.status === 'rejected' && r.reason?.message !== 'Promise timed out')
        .map(r => r.reason);

    if (errors.length) {
        console.error('Error in processExternalPromisesWithTimeout:', errors);
    }

    return results.map(r => (r.status === 'fulfilled' ? r.value : null));
}

export default processExternalPromisesWithTimeout;
