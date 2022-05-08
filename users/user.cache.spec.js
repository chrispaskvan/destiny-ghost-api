const UserCache = require('./user.cache');
const mockUser = require('../mocks/users.json')[0];

describe('UserCache', () => {
    let cacheService;
    let client;

    describe('deleteUser', () => {
        beforeEach(() => {
            client = {
                del: jest.fn((key, callback) => callback(undefined, 1)),
            };

            cacheService = new UserCache({ client });
        });

        describe('when phone number, display name, and membership type are given', () => {
            it('delete user', async () => {
                const res = await cacheService.deleteUser(mockUser);

                expect(res).toEqual([1, 1]);
                expect(client.del).toHaveBeenCalledTimes(2);
            });
        });

        describe('when neither phone number or display name and membership type are given', () => {
            it('delete user', async () => {
                const res = await cacheService.deleteUser({});

                expect(res).toEqual([undefined, undefined]);
                expect(client.del).not.toHaveBeenCalled();
            });
        });

        afterEach(() => jest.clearAllMocks());
    });

    describe('getCache', () => {
        const cacheKey = 'key';

        describe('when client get operation succeeds', () => {
            describe('when cache is found', () => {
                it('resolves value', async () => {
                    client = {
                        get:
                        jest.fn((key, callback) => callback(undefined, JSON.stringify(mockUser))),
                    };

                    cacheService = new UserCache({ client });

                    const res = await cacheService.getCache(cacheKey);

                    expect(res).toEqual(mockUser);
                });
            });

            describe('when cache is not found', () => {
                it('resolves value', async () => {
                    client = {
                        get: jest.fn((key, callback) => callback(undefined, undefined)),
                    };

                    cacheService = new UserCache({ client });

                    const res = await cacheService.getCache(cacheKey);

                    expect(res).toBeUndefined();
                });
            });
        });

        describe('when client get operation fails', () => {
            it('rejects', async () => {
                const errMessage = 'error';

                client = {
                    get: jest.fn(() => {
                        throw new Error(errMessage);
                    }),
                };

                cacheService = new UserCache({ client });

                await expect(cacheService.getCache(cacheKey))
                    .rejects.toThrow(errMessage);
            });
        });
    });

    describe('getUser', () => {
        beforeEach(() => {
            client = {
                del: jest.fn((key, callback) => callback(undefined, 1)),
                get: jest.fn((key, callback) => callback(undefined, JSON.stringify(mockUser))),
                quit: jest.fn(),
                set: jest.fn((key, value, option, ttl, callback) => callback()),
            };

            cacheService = new UserCache({ client });
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
            beforeEach(() => {
                client = {
                    set: jest.fn((key, value, option, ttl, callback) => callback()),
                };

                cacheService = new UserCache({ client });
            });

            describe('when display name is not found', () => {
                it('rejects', async () => {
                    await expect(cacheService.setUser()).rejects.toThrow(new Error('displayName not found'));
                });
            });

            describe('when display name is found, but membership type is not', () => {
                it('rejects', async () => {
                    await expect(cacheService.setUser({
                        displayName: 11,
                    })).rejects.toThrow(new Error('membershipType not found'));
                });
            });

            describe('when display name and membership type are given', () => {
                describe('when email address is not included', () => {
                    it('cache user', async () => {
                        const { emailAddress, ...mockUser1 } = mockUser;
                        const res = await cacheService.setUser(mockUser1);

                        expect(res).toEqual([undefined, undefined, undefined]);
                        expect(client.set).toHaveBeenCalledTimes(2);
                    });
                });

                describe('when phone number is not included', () => {
                    it('cache user', async () => {
                        const { phoneNumber, ...mockUser1 } = mockUser;
                        const res = await cacheService.setUser(mockUser1);

                        expect(res).toEqual([undefined, undefined, undefined]);
                        expect(client.set).toHaveBeenCalledTimes(2);
                    });
                });

                describe('when email address and phone number is included', () => {
                    it('cache user', async () => {
                        const res = await cacheService.setUser(mockUser);

                        expect(res).toEqual([undefined, undefined, undefined]);
                        expect(client.set).toHaveBeenCalledTimes(3);
                    });
                });
            });
            afterEach(() => jest.clearAllMocks());
        });

        describe('when client set operation fails', () => {
            it('cache user', async () => {
                const errMessage = 'error';

                client = {
                    set: jest.fn(() => {
                        throw new Error(errMessage);
                    }),
                };
                cacheService = new UserCache({ client });

                await expect(cacheService.setUser(mockUser))
                    .rejects.toThrow(errMessage);
            });
        });
    });
});
