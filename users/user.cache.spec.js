const UserCache = require('./user.cache'),
    expect = require('chai').expect,
    mockUser = require('../mocks/users.json')[0];

let cacheService;

beforeEach(function () {
    cacheService = new UserCache();
});

describe('UserCache', function () {
    it('set, get, and delete user', function () {
        return cacheService.setUser(mockUser)
            .then(() => cacheService.getUser(mockUser.phoneNumber))
            .then(user1 => {
                expect(user1).to.eql(mockUser);

                return cacheService.deleteUser(user1);
            }).then(res => {
                expect(res).to.eql([1, 1]);

                return cacheService.getUser(mockUser.phoneNumber);
            }).then(user2 => expect(user2).to.be.undefined);
    });
});
