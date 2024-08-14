const sleep = delay => new Promise(resolve => {
    setTimeout(resolve, delay);
});

export default async function throttle(tasks, concurrency, wait) {
    const results = [];

    async function runTasks(tasksIterator) {
        for (const [index, task] of tasksIterator) {
            const [result] = await Promise.allSettled([task]);

            results[index] = result;

            if (wait && !Number.isNaN(Number.parseInt(wait, 10))) {
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
