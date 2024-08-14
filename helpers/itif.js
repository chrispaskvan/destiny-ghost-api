import { it } from 'vitest';

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
