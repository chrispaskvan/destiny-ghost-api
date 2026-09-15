// @ts-check
import { it } from 'vitest';

/**
 * @param {string} name
 * @param {() => boolean | Promise<boolean>} condition
 * @param {(done: () => void) => Promise<void>} cb
 */
const itif = (name, condition, cb) => {
    it(name, async () => {
        const done = () => {};

        if (await condition()) {
            await cb(done);
        } else {
            done();
        }
    });
};

export default itif;
