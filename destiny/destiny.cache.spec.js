const DestinyCache = require('./destiny.cache');

describe('AuthenticationService', () => {
    describe('secondsUntilDailyReset', () => {
        let currentDate;
        let realDate;

        beforeEach(() => {
            realDate = Date;
            global.Date = class extends Date {
                constructor(date) {
                    if (date) {
                        // eslint-disable-next-line constructor-super, no-constructor-return
                        return super(date);
                    }

                    // eslint-disable-next-line constructor-super, no-constructor-return
                    return currentDate;
                }
            };
        });
        afterEach(() => {
            global.Date = realDate;
        });
        describe('when the current date and time is after the reset', () => {
            it('time to reset tomorrow', () => {
                currentDate = new Date('2020-04-25T18:00:00.000Z');

                const resetIn = DestinyCache.secondsUntilDailyReset();

                expect(resetIn).toEqual(82800); // 23 hours
            });
        });
        describe('when the current date and time is before the reset', () => {
            it('time to reset today', () => {
                currentDate = new Date('2020-04-25T16:00:00.000Z');

                const resetIn = DestinyCache.secondsUntilDailyReset();

                expect(resetIn).toEqual(3600); // 1 hour
            });
        });
    });
});
