const chance = require('chance')();
const { EventEmitter } = require('events');
const httpMocks = require('node-mocks-http');

const Destiny2Controller = require('./destiny2.controller');
const { Response: manifest } = require('../mocks/manifest2Response.json');

const destiny2Service = {
    getManifest: () => Promise.resolve(manifest),
    getProfile: () => Promise.resolve(),
};
const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });
const userService = {
    getUserByDisplayName: jest.fn(() => Promise.resolve()),
};

let destiny2Controller;

beforeEach(() => {
    const world = {
        getClassByHash: jest.fn(() => Promise.resolve({
            classType: 1,
            displayProperties: {
                name: 'Hunter',
                hasIcon: false,
            },
            genderedClassNames: {
                Male: 'Hunter',
                Female: 'Hunter',
            },
            hash: 671679327,
            index: 1,
            redacted: false,
        })),
    };

    destiny2Controller = new Destiny2Controller({
        destinyService: destiny2Service,
        userService,
        worldRepository: world,
    });
});

describe('Destiny2Controller', () => {
    let res;

    beforeEach(() => {
        res = httpMocks.createResponse({
            eventEmitter: EventEmitter,
        });
    });

    describe('getProfile', () => {
        describe('when session displayName and membershipType are defined', () => {
            describe('when user and destiny services return a user', () => {
                it('should return user profile', done => {
                    const req = httpMocks.createRequest({
                        session: {
                            displayName,
                            membershipType,
                        },
                    });

                    destiny2Service.getProfile = jest.fn().mockResolvedValue([
                        {
                            characterId: '1111111111111111111',
                            classHash: 671679327,
                            light: 284,
                            links: [
                                {
                                    rel: 'Character',
                                    href: '/characters/1111111111111111111',
                                },
                            ],
                        },
                    ]);
                    userService.getUserByDisplayName = jest.fn().mockResolvedValue({
                        membershipId: '1',
                    });

                    res.on('end', () => {
                        const data = JSON.parse(res._getData()); // eslint-disable-line max-len, no-underscore-dangle

                        try {
                            expect(res.statusCode).toEqual(200);
                            expect(data[0].className).toEqual('Hunter');
                            done();
                        } catch (err) {
                            done(err);
                        }
                    });

                    destiny2Controller.getProfile(req, res);
                });
            });
        });
    });
});
