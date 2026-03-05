const sleep = delay => new Promise(resolve => {
    setTimeout(resolve, delay);
});

export default async function throttle(tasks, concurrency, wait) {
    const results = new Array(tasks.length);
    const executing = new Set();
    const hasWait = wait && !Number.isNaN(Number.parseInt(wait, 10));

    for (let i = 0; i < tasks.length; i++) {
        const p = Promise.resolve(tasks[i])
            .then(
                value => { results[i] = { status: 'fulfilled', value }; },
                reason => { results[i] = { status: 'rejected', reason }; },
            )
            .finally(() => executing.delete(p));

        executing.add(p);

        if (executing.size >= concurrency) {
            await Promise.race(executing);
        }

        if (hasWait) {
            await sleep(wait);
        }
    }

    await Promise.allSettled(executing);

    return results;
}
