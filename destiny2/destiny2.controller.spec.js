import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';
import Destiny2Controller from './destiny2.controller';
import manifest2Response from '../mocks/manifest2Response.json';

vi.mock('../helpers/request');

const { Response: manifest } = manifest2Response;
const chance = new Chance();
const characterId = '11';
const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });

const destiny2Service = {
    getManifest: () => Promise.resolve(manifest),
    getProfile: vi.fn().mockResolvedValue([
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
    ]),
};
const userService = {
    getUserByDisplayName: vi.fn(() => Promise.resolve()),
};

let destiny2Controller;

beforeEach(() => {
    const world = {
        getClassByHash: vi.fn(() => Promise.resolve({
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
        getItemByHash: vi.fn(() => Promise.resolve({
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
    describe('getProfile', () => {
        describe('when session displayName and membershipType are defined', () => {
            describe('when user and destiny services return a user', () => {
                it('should return user profile', async () => {
                    userService.getUserByDisplayName = vi.fn().mockResolvedValue({
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

                    destiny2Service.getXur = vi.fn().mockResolvedValue([
                        'some-item-hash',
                    ]);
                    userService.getUserByDisplayName = vi.fn().mockResolvedValue({
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
