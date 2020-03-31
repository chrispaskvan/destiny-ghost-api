const redis = require('redis');
const UserCache = require('./user.cache');
const mockUser = require('../mocks/users.json')[0];

describe('UserCache', () => {
    let cacheService;

    describe('deleteCache', () => {
        const cacheKey = 'key';

        describe('when client del operation succeeds', () => {
            const clientResponse = 1;

            beforeEach(() => {
                redis.createClient = jest.fn(() => {
                    const client = {
                        del: jest.fn((key, callback) => callback(undefined, clientResponse)),
                        quit: jest.fn(),
                    };

                    return client;
                });

                cacheService = new UserCache();
            });

            it('resolves', async () => {
                const res = await cacheService.deleteCache(cacheKey);

                expect(res).toEqual(clientResponse);
            });
        });

        describe('when client del operation fails', () => {
            const errMessage = 'error';

            beforeEach(() => {
                redis.createClient = jest.fn(() => {
                    const client = {
                        del: jest.fn((key, callback) => callback(errMessage)),
                        quit: jest.fn(),
                    };

                    return client;
                });

                cacheService = new UserCache();
            });

            it('resolves', () => cacheService.deleteCache(cacheKey)
                .then(res => expect(res).toBeUndefined())
                .catch(err => {
                    expect(err).toEqual(errMessage);
                }));
        });
    });

    describe('deleteUser', () => {
        const del = jest.fn((key, callback) => callback(undefined, 1));

        beforeEach(() => {
            redis.createClient = jest.fn(() => {
                const client = {
                    del,
                };

                return client;
            });

            cacheService = new UserCache();
        });

        describe('when phone number, display name, and membership type are given', () => {
            it('delete user', async () => {
                const res = await cacheService.deleteUser(mockUser);

                expect(res).toEqual([1, 1]);
                expect(del).toHaveBeenCalledTimes(2);
            });
        });

        describe('when neither phone number or display name and membership type are given', () => {
            it('delete user', async () => {
                const res = await cacheService.deleteUser({});

                expect(res).toEqual([undefined, undefined]);
                expect(del).not.toHaveBeenCalled();
            });
        });

        afterEach(() => jest.clearAllMocks());
    });

    describe('destroy', () => {
        it('calls quit', () => {
            const quit = jest.fn();

            redis.createClient = jest.fn(() => {
                const client = {
                    quit,
                };

                return client;
            });

            cacheService = new UserCache();

            cacheService.destroy();

            expect(quit).toHaveBeenCalled();
        });
    });

    describe('getCache', () => {
        const cacheKey = 'key';

        describe('when client get operation succeeds', () => {
            describe('when cache is found', () => {
                it('resolves value', async () => {
                    redis.createClient = jest.fn(() => {
                        const client = {
                            get: jest.fn((key, callback) => callback(undefined, JSON.stringify(mockUser))), // eslint-disable-line max-len
                        };

                        return client;
                    });

                    cacheService = new UserCache();

                    const res = await cacheService.getCache(cacheKey);

                    expect(res).toEqual(mockUser);
                });
            });

            describe('when cache is not found', () => {
                it('resolves value', async () => {
                    redis.createClient = jest.fn(() => {
                        const client = {
                            get: jest.fn((key, callback) => callback(undefined, undefined)),
                        };

                        return client;
                    });

                    cacheService = new UserCache();

                    const res = await cacheService.getCache(cacheKey);

                    expect(res).toBeUndefined();
                });
            });
        });

        describe('when client get operation fails', () => {
            it('returns undefined', () => {
                const errMessage = 'error';

                redis.createClient = jest.fn(() => {
                    const client = {
                        get: jest.fn((key, callback) => callback(errMessage, undefined)),
                    };

                    return client;
                });

                cacheService = new UserCache();

                return cacheService.getCache(cacheKey)
                    .then(res => expect(res).toBeUndefined())
                    .catch(err => {
                        expect(err).toEqual(errMessage);
                    });
            });
        });
    });

    describe('getUser', () => {
        beforeEach(() => {
            redis.createClient = jest.fn(() => {
                const client = {
                    del: jest.fn((key, callback) => callback(undefined, 1)),
                    get: jest.fn((key, callback) => callback(undefined, JSON.stringify(mockUser))), // eslint-disable-line max-len
                    quit: jest.fn(),
                    set: jest.fn((key, value, callback) => callback()),
                };

                return client;
            });

            cacheService = new UserCache();
        });

        describe('when cached user is found', () => {
            describe('when membershipId is found', () => {
                it('returns user', async () => {
                    jest.spyOn(cacheService, 'getCache')
                        .mockResolvedValueOnce(mockUser);

                    const user = await cacheService.getUser();

                    expect(user).toEqual(mockUser);
                    expect(cacheService.getCache).toHaveBeenCalledTimes(1);
                });
            });

            describe('when membershipId is not found', () => {
                it('returns user', async () => {
                    const { membershipId, ...mockUser1 } = mockUser;

                    jest.spyOn(cacheService, 'getCache')
                        .mockResolvedValueOnce(mockUser1)
                        .mockResolvedValueOnce(mockUser);

                    const user = await cacheService.getUser();

                    expect(user).toEqual(mockUser);
                    expect(cacheService.getCache).toHaveBeenCalledTimes(2);
                });
            });
        });

        describe('when cached user is not found', () => {
            it('return undefined', async () => {
                cacheService.getCache = jest.fn()
                    .mockImplementation(() => Promise.resolve());

                const user = await cacheService.getUser();

                expect(user).toBeUndefined();
            });
        });
    });

    describe('setUser', () => {
        describe('when client set operation succeeds', () => {
            const set = jest.fn((key, value, callback) => callback());

            beforeEach(() => {
                redis.createClient = jest.fn(() => {
                    const client = {
                        set,
                    };

                    return client;
                });

                cacheService = new UserCache();
            });

            describe('when display name is not found', () => {
                it('rejects', () => cacheService.setUser()
                    .catch(err => {
                        expect(err).toEqual(new Error('displayName not found'));
                    }));
            });

            describe('when display name is found, but membership type is not', () => {
                it('rejects', () => cacheService.setUser({
                    displayName: 11,
                })
                    .catch(err => {
                        expect(err).toEqual(new Error('membershipType not found'));
                    }));
            });

            describe('when display name and membership type are given', () => {
                describe('when phone number is not included', () => {
                    it('cache user', async () => {
                        const { phoneNumber, ...mockUser1 } = mockUser;
                        const res = await cacheService.setUser(mockUser1);

                        expect(res).toEqual([undefined, undefined]);
                        expect(set).toHaveBeenCalledTimes(1);
                    });
                });

                describe('when phone number is included', () => {
                    it('cache user', async () => {
                        const res = await cacheService.setUser(mockUser);

                        expect(res).toEqual([undefined, undefined]);
                        expect(set).toHaveBeenCalledTimes(2);
                    });
                });
            });
            afterEach(() => jest.clearAllMocks());
        });

        describe('when client set operation fails', () => {
            it('cache user', async () => {
                const errMessage = 'error';

                redis.createClient = jest.fn(() => {
                    const client = {
                        set: jest.fn((key, value, callback) => callback(errMessage, undefined)),
                    };

                    return client;
                });

                cacheService = new UserCache();

                return cacheService.setUser(mockUser)
                    .then(res => expect(res).toBeUndefined())
                    .catch(err => {
                        expect(err).toEqual(errMessage);
                    });
            });
        });
    });
});
