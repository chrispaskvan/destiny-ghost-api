const sleep = delay => new Promise(resolve => {
    setTimeout(resolve, delay);
});

export default async function throttle(tasks, concurrency, wait) {
    const results = [];
    const hasWait = wait && !Number.isNaN(Number.parseInt(wait, 10));

    for (let i = 0; i < tasks.length; i += concurrency) {
        if (hasWait && i > 0) {
            await sleep(wait);
        }

        const batch = tasks.slice(i, i + concurrency);
        const settled = await Promise.allSettled(batch);

        settled.forEach((result, j) => {
            results[i + j] = result;
        });
    }

    return results;
}
