const HttpStatus = require('http-status-codes');
const chance = require('chance')();
const { EventEmitter } = require('events');
const httpMocks = require('node-mocks-http');

const Destiny2Router = require('./destiny2.routes');
const { Response: manifest } = require('../mocks/manifest2Response.json');

const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });
const authenticationController = {
    authenticate: jest.fn(() => ({
        displayName,
        membershipType,
    })),
};
const destiny2Service = {
    getManifest: () => Promise.resolve(manifest),
    getProfile: () => Promise.resolve(),
};
const userService = {
    getUserByDisplayName: jest.fn(() => Promise.resolve()),
};

let destiny2Router;

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
            hash: '671679327',
            index: 1,
            redacted: false,
        })),
    };

    destiny2Router = Destiny2Router({
        authenticationController,
        destiny2Service,
        userService,
        worldRepository: world,
    });
});

describe('Destiny2Router', () => {
    let res;

    beforeEach(() => {
        res = httpMocks.createResponse({
            eventEmitter: EventEmitter,
        });
    });

    describe('getProfile', () => {
        describe('when session displayName and membershipType are defined', () => {
            describe('when user and destiny services return a user', () => {
                it('should return user profile', () => new Promise((done, reject) => {
                    const req = httpMocks.createRequest({
                        method: 'GET',
                        url: '/profile',
                        session: {
                            displayName,
                            membershipType,
                        },
                    });

                    destiny2Service.getProfile = jest.fn().mockResolvedValue([
                        {
                            characterId: '1111111111111111111',
                            classHash: '671679327',
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
                        // eslint-disable-next-line no-underscore-dangle
                        const data = JSON.parse(res._getData());

                        try {
                            expect(res.statusCode).toEqual(HttpStatus.OK);
                            expect(data[0].className).toEqual('Hunter');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    destiny2Router(req, res);
                }));
            });
        });

        describe('when session displayName and membershipType are not defined', () => {
            it('should respond with unauthorized', () => new Promise((done, reject) => {
                const req = httpMocks.createRequest({
                    method: 'GET',
                    url: '/profile',
                    session: {},
                });

                authenticationController.authenticate = jest.fn().mockResolvedValue(undefined);
                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(HttpStatus.UNAUTHORIZED);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                destiny2Router(req, res);
            }));
        });
    });
});
