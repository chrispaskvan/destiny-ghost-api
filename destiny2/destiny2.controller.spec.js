const Chance = require('chance');

const Destiny2Controller = require('./destiny2.controller');
const { Response: manifest } = require('../mocks/manifest2Response.json');

const chance = new Chance();
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
            hash: '671679327',
            index: 1,
            redacted: false,
        })),
        getItemByHash: jest.fn(() => Promise.resolve({
            displayProperties: {
                name: 'Eyasluna',
            },
        })),
    };

    destiny2Controller = new Destiny2Controller({
        destinyService: destiny2Service,
        userService,
        worldRepository: world,
    });
});

describe('Destiny2Controller', () => {
    const characterId = '1111111111111111111';

    describe('getProfile', () => {
        describe('when session displayName and membershipType are defined', () => {
            describe('when user and destiny services return a user', () => {
                it('should return user profile', async () => {
                    destiny2Service.getProfile = jest.fn().mockResolvedValue([
                        {
                            characterId,
                            classHash: '671679327',
                            light: 284,
                            links: [
                                {
                                    rel: 'Character',
                                    href: `/characters/${characterId}`,
                                },
                            ],
                        },
                    ]);
                    userService.getUserByDisplayName = jest.fn().mockResolvedValue({
                        membershipId: '1',
                    });

                    const [{ className }] = await destiny2Controller
                        .getCharacters(displayName, membershipType);

                    expect(className).toEqual('Hunter');
                });
            });
        });
    });

    describe('getXur', () => {
        describe('when session displayName and membershipType are defined', () => {
            describe('when user and destiny services return a user', () => {
                it('should return user profile', async () => {
                    const accessToken = 'some-access-token';
                    const membershipId = '1';

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
                    destiny2Service.getXur = jest.fn().mockResolvedValue([
                        'some-item-hash',
                    ]);
                    userService.getUserByDisplayName = jest.fn().mockResolvedValue({
                        bungie: {
                            access_token: accessToken,
                        },
                        membershipId,
                    });

                    const saleItems = await destiny2Controller
                        .getXur(displayName, membershipType);

                    expect(saleItems).toEqual([{
                        displayProperties: {
                            name: 'Eyasluna',
                        },
                    }]);
                    expect(destiny2Service.getXur)
                        .toHaveBeenCalledWith(membershipId, membershipType, characterId, accessToken); // eslint-disable-line max-len
                });
            });
        });
    });
});
