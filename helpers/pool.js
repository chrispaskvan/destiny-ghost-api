import TinyPool from 'tinypool';

const pool = new TinyPool({ filename: new URL('./worker.js', import.meta.url).href });

const run = data => pool.run(data);
const close = () => pool.destroy();

export default { run, close };
