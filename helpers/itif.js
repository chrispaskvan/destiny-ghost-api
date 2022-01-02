const itif = (name, condition, cb) => {
    // eslint-disable-next-line jest/expect-expect, jest/no-done-callback, jest/valid-title
    it(name, async () => {
        const done = () => {};

        if (await condition()) {
            await cb(done);
        } else {
            done();
        }
    });
};

// eslint-disable-next-line jest/no-export
module.exports = itif;
