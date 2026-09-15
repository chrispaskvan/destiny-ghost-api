import Chance from 'chance';
import { describe, expect, it, vi } from 'vitest';
import root from './root.js';

const chance = new Chance();
const mockPlayer = {
    destinyMemberships: [
        {
            crossSaveOverride: 0,
            displayName: chance.name(),
            membershipId: chance.integer(),
            membershipType: chance.integer(),
        },
    ],
};
const mockPlayers = [mockPlayer];
const mockContext = {
    destiny2Service: {
        constructor: {
            findPlayers: vi.fn(() => Promise.resolve(mockPlayers)),
        },
        getPlayerStatistics: vi.fn(),
    },
    isAdministrator: true,
    userService: {
        getUserByDisplayName: vi.fn(),
    },
};

describe('root', () => {
    describe('findPlayers', () => {
        it('should return players with statistics and user with throttle', async () => {
            const players = await root.findPlayers(
                {
                    displayName: mockPlayer.destinyMemberships[0].displayName,
                },
                mockContext,
            );

            expect(players).toEqual(mockPlayers);
            expect(mockContext.destiny2Service.getPlayerStatistics).toHaveBeenCalledWith(
                mockPlayer.destinyMemberships[0].membershipId,
                mockPlayer.destinyMemberships[0].membershipType,
            );
            expect(mockContext.userService.getUserByDisplayName).toHaveBeenCalledWith(
                mockPlayer.destinyMemberships[0].displayName,
                mockPlayer.destinyMemberships[0].membershipType,
            );
        });

        it('should return empty statistics and no user when destinyMemberships is missing', async () => {
            const playerWithNoMembership = {};

            mockContext.destiny2Service.constructor.findPlayers = vi
                .fn()
                .mockResolvedValue([playerWithNoMembership]);
            mockContext.destiny2Service.getPlayerStatistics = vi
                .fn()
                .mockResolvedValue({ pvp: {} });
            mockContext.isAdministrator = true;
            mockContext.userService.getUserByDisplayName.mockClear();

            const players = await root.findPlayers(
                {
                    displayName: 'no-membership-player',
                },
                mockContext,
            );

            expect(mockContext.destiny2Service.getPlayerStatistics).toHaveBeenCalledWith(
                undefined,
                undefined,
            );
            expect(mockContext.userService.getUserByDisplayName).not.toHaveBeenCalled();
            expect(players).toEqual([
                {
                    destinyMemberships: [],
                    statistics: { pvp: {} },
                    user: null,
                },
            ]);
        });

        it.skip('should return players with statistics and no user', async () => {
            mockContext.isAdministrator = false;

            const players = await root.findPlayers(
                {
                    displayName: mockPlayer.destinyMemberships[0].displayName,
                },
                mockContext,
            );

            expect(players).toEqual(mockPlayers);
            expect(mockContext.destiny2Service.getPlayerStatistics).toHaveBeenCalledWith(
                mockPlayer.destinyMemberships[0].membershipId,
                mockPlayer.destinyMemberships[0].membershipType,
            );
            expect(mockContext.userService.getUserByDisplayName).not.toHaveBeenCalled();
        });
    });
});
