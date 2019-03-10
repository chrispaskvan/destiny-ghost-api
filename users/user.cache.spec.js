const redis = require('redis'),
    UserCache = require('./user.cache'),
    mockUser = require('../mocks/users.json')[0];

redis.createClient = jest.fn(() => {
	const client = {
		del: jest.fn((key, callback) => callback(undefined, 1)),
        get: jest.fn((key, callback) => callback(undefined, JSON.stringify(mockUser))),
        quit: jest.fn(),
        set: jest.fn((key, value, callback) => callback())
    };

	return client;
});

let cacheService;

beforeEach(() => {
    cacheService = new UserCache();
});

describe('UserCache', () => {
    it('set, get, and delete user', () => {
        return cacheService.setUser(mockUser)
            .then(() => cacheService.getUser(mockUser.phoneNumber))
            .then(user1 => {
                expect(user1).toEqual(mockUser);

                return cacheService.deleteUser(user1);
            }).then(res => {
                expect(res).toEqual([1, 1]);

                return cacheService.getUser(mockUser.phoneNumber);
            }).then(user2 => expect(user2).toBeUndefined);
    });
});

afterEach(() => cacheService.destroy());
