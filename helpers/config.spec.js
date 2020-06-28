describe('config', () => {
    const { env } = process;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...env };
        delete process.env.NODE_ENV;
    });

    afterEach(() => {
        process.env = env;
    });

    it('get the configuration', async () => {
        process.env.NODE_ENV = 'production';

        const config = require('./config'); // eslint-disable-line global-require

        expect(config).toBeDefined();
    });
});
