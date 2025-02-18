async function processExternalPromisesWithTimeout(externalPromises, timeout) {
    const controller = new AbortController();
    const signal = controller.signal;

    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const results = await Promise.all(
            externalPromises.map(async externalPromise => {
                return new Promise((resolve, reject) => {
                    Promise.race([
                        externalPromise,
                        new Promise((_, rj) => signal.addEventListener('abort', () => rj(new Error('Promise timed out')))),
                    ]).then(resolve, reject);
                });
            })
        );

        clearTimeout(timeoutId);

        return results;
    } catch (err) {
        clearTimeout(timeoutId);

        if (err?.message === 'Promise timed out') {
            console.error('At least one external promise timed out');

            return null;
        } else {
            console.error('Error in processExternalPromisesWithTimeout:', err);

            throw err;
        }
    }
}

export default processExternalPromisesWithTimeout;
