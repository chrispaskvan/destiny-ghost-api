const sleep = delay => new Promise(resolve => {
    setTimeout(resolve, delay);
});

export default async function throttle(tasks, concurrency, wait) {
    const results = [];

    async function runTasks(tasksIterator) {
        // eslint-disable-next-line no-restricted-syntax
        for (const [index, task] of tasksIterator) {
            // eslint-disable-next-line no-await-in-loop
            const [result] = await Promise.allSettled([task]);
            // eslint-disable-next-line security/detect-object-injection
            results[index] = result;

            if (wait && !Number.isNaN(Number.parseInt(wait, 10))) {
                // eslint-disable-next-line no-await-in-loop
                await sleep(wait);
            }
        }
    }

    const workers = new Array(concurrency)
        .fill(tasks.entries())
        .map(runTasks);

    await Promise.allSettled(workers);

    return results;
}
