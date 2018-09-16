const log = require('./log');

describe('Log', () => {
    it('Should write to log', function (done) {
        const responseData = {
            messageId: '1',
            wasSuccessful: true,
            code: 200
        };

        log.info(JSON.stringify(responseData));

        const promise = new Promise(() => {
            throw new Error('Where\'s Cade?');
        });

        promise
            .catch(err => {
                log.error(err);
                done();
            });
    });
});
