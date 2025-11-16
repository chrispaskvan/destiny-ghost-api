import {
    describe, it, expect, vi, beforeEach,
} from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpServer } from './mcp.server.js';

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
    const McpServer = vi.fn();
    McpServer.prototype.registerTool = vi.fn();
    return { McpServer };
});

describe('createMcpServer', () => {
    let mockDestinyController;
    let mockUser;
    let mockServerInstance;

    beforeEach(() => {
        vi.clearAllMocks();

        mockDestinyController = {
            getCharacters: vi.fn(),
            getXur: vi.fn(),
        };

        mockUser = {
            displayName: 'test-user',
            membershipType: 'test-type',
        };

        mockServerInstance = {
            registerTool: vi.fn(),
        };
        McpServer.mockImplementation(() => mockServerInstance);
    });

    it('should create and configure an McpServer instance', () => {
        createMcpServer({
            destinyController: mockDestinyController,
            user: mockUser,
        });

        expect(McpServer).toHaveBeenCalledWith({
            name: 'destiny-ghost',
            version: process.env.npm_package_version,
        });
    });

    it('should register the "get-characters" tool', () => {
        createMcpServer({
            destinyController: mockDestinyController,
            user: mockUser,
        });

        expect(mockServerInstance.registerTool).toHaveBeenCalledWith(
            'get-characters',
            expect.any(Object),
            expect.any(Function)
        );
    });

    it('should register the "get-xur-inventory-for-character" tool', () => {
        createMcpServer({
            destinyController: mockDestinyController,
            user: mockUser,
        });

        expect(mockServerInstance.registerTool).toHaveBeenCalledWith(
            'get-xur-inventory-for-character',
            expect.any(Object),
            expect.any(Function)
        );
    });

    describe('get-characters tool handler', () => {
        it('should call destinyController.getCharacters and return structured content', async () => {
            const mockCharacters = [
                { characterId: '1', className: 'Titan', powerLevel: 1800 },
                { characterId: '2', className: 'Hunter', powerLevel: 1810 },
            ];

            mockDestinyController.getCharacters.mockResolvedValue(mockCharacters);

            createMcpServer({
                destinyController: mockDestinyController,
                user: mockUser,
            });

            const handler = mockServerInstance.registerTool.mock.calls.find(
                call => call[0] === 'get-characters'
            )[2];
            const result = await handler();

            expect(mockDestinyController.getCharacters).toHaveBeenCalledWith(
                mockUser.displayName,
                mockUser.membershipType
            );
            expect(result).toEqual({
                content: [{ type: 'text', text: `Retrieved ${mockCharacters.length} characters.` }],
                structuredContent: { characters: mockCharacters },
            });
        });

        it('should throw an error if character validation fails', async () => {
            const invalidCharacters = [{ characterId: '1', className: 'Warlock' }]; // Missing powerLevel

            mockDestinyController.getCharacters.mockResolvedValue(invalidCharacters);
            createMcpServer({
                destinyController: mockDestinyController,
                user: mockUser,
            });

            const handler = mockServerInstance.registerTool.mock.calls.find(
                call => call[0] === 'get-characters'
            )[2];

            await expect(handler()).rejects.toThrow('Validation of character list failed');
        });
    });

    describe('get-xur-inventory-for-character tool handler', () => {
        it('should call destinyController.getXur and return structured content', async () => {
            const characterId = 'char123';
            const mockItems = [
                { itemTypeAndTierDisplayName: 'Exotic Engram', displayProperties: { name: 'Exotic Engram' } },
                { itemTypeAndTierDisplayName: 'Exotic Weapon', displayProperties: { name: 'Gjallarhorn' } },
            ];
            mockDestinyController.getXur.mockResolvedValue(mockItems);

            createMcpServer({
                destinyController: mockDestinyController,
                user: mockUser,
            });

            const handler = mockServerInstance.registerTool.mock.calls.find(
                call => call[0] === 'get-xur-inventory-for-character'
            )[2];

            const result = await handler({ characterId });

            expect(mockDestinyController.getXur).toHaveBeenCalledWith(
                mockUser.displayName,
                mockUser.membershipType,
                characterId
            );
            expect(result).toEqual({
                content: [{ type: 'text', text: `Retrieved ${mockItems.length} items.` }],
                structuredContent: { items: mockItems },
            });
        });

        it('should throw an error if item validation fails', async () => {
            const invalidItems = [{ itemTypeAndTierDisplayName: 'Exotic Armor' }]; // Missing displayProperties

            mockDestinyController.getXur.mockResolvedValue(invalidItems);

            createMcpServer({
                destinyController: mockDestinyController,
                user: mockUser,
            });

            const handler = mockServerInstance.registerTool.mock.calls.find(
                call => call[0] === 'get-xur-inventory-for-character'
            )[2];

            await expect(handler({ characterId: 'char123' })).rejects.toThrow('Validation of character list failed');
        });
    });
});
