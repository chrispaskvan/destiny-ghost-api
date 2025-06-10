import { describe, it, expect, vi, beforeEach } from 'vitest';
import DestinyController from './destiny.controller.js';

describe('DestinyController', () => {
    let destinyService, userService, worldRepository, controller;

    beforeEach(() => {
        destinyService = {
            getAuthorizationUrl: vi.fn(),
            getCurrentUser: vi.fn(),
            getManifest: vi.fn()
        };
        userService = {
            getUserByDisplayName: vi.fn()
        };
        worldRepository = {
            getGrimoireCards: vi.fn(),
            updateManifest: vi.fn()
        };
        controller = new DestinyController({
            destinyService,
            userService,
            worldRepository
        });
    });

    describe('getAuthorizationUrl', () => {
        it('should return state and url', async () => {
            destinyService.getAuthorizationUrl.mockResolvedValue('http://auth.url');

            const result = await controller.getAuthorizationUrl();

            expect(result).toHaveProperty('state');
            expect(result).toHaveProperty('url', 'http://auth.url');
            expect(destinyService.getAuthorizationUrl).toHaveBeenCalledWith(result.state);
        });
    });

    describe('getCurrentUser', () => {
        it('should get user by displayName and membershipType and fetch current user', async () => {
            userService.getUserByDisplayName.mockResolvedValue({
                bungie: { access_token: 'token123' }
            });
            destinyService.getCurrentUser.mockResolvedValue({ id: 1, name: 'Test' });

            const result = await controller.getCurrentUser('displayName', 2);

            expect(userService.getUserByDisplayName).toHaveBeenCalledWith('displayName', 2);
            expect(destinyService.getCurrentUser).toHaveBeenCalledWith('token123');
            expect(result).toEqual({ id: 1, name: 'Test' });
        });
    });

    describe('getGrimoireCards', () => {
        it('should get grimoire cards from world repository', async () => {
            worldRepository.getGrimoireCards.mockResolvedValue(['card1', 'card2']);

            const result = await controller.getGrimoireCards(2);

            expect(worldRepository.getGrimoireCards).toHaveBeenCalledWith(2);
            expect(result).toEqual(['card1', 'card2']);
        });
    });

    describe('getManifest', () => {
        it('should get manifest from destiny service', async () => {
            destinyService.getManifest.mockResolvedValue({ manifest: 'data' });

            const result = await controller.getManifest(true);

            expect(destinyService.getManifest).toHaveBeenCalledWith(true);
            expect(result).toEqual({ manifest: 'data' });
        });
    });

    describe('upsertManifest', () => {
        it('should update manifest in world repository', async () => {
            destinyService.getManifest.mockResolvedValue({ data: { manifest: { foo: 'bar' } } });
            worldRepository.updateManifest.mockResolvedValue('updated');

            const result = await controller.upsertManifest();

            expect(destinyService.getManifest).toHaveBeenCalledWith(true);
            expect(worldRepository.updateManifest).toHaveBeenCalledWith({ foo: 'bar' });
            expect(result).toBe('updated');
        });
    });
});
