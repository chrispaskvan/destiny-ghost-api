import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Factory to create and configure a new McpServer.
 * This factory is context-aware. It accepts dependencies like services and the
 * authenticated user object, making them available to all registered tools.
 *
 * @param {object} deps - The dependencies for the server.
 * @param {object} deps.destinyController - The Destiny 2 controller instance.
 * @param {object} deps.user - The authenticated user object.
 * @returns {McpServer} A new McpServer instance configured for the given user.
 */

export function createMcpServer({
    destinyController,
    user,
}) {
    const server = new McpServer({
        name: 'destiny-ghost',
        version: process.env.npm_package_version
    });
    const characterSchema = z.object({
        characterId: z.string(),
        className: z.string(),
        powerLevel: z.number(),
    });
    const itemSchema = z.object({
        itemTypeAndTierDisplayName: z.string(),
        displayProperties: z.object({
            name: z.string(),
        }),
    });

    server.registerTool(
        'get-characters',
        {
            title: 'Get Destiny 2 Characters',
            description: 'Return the list of Destiny 2 characters for the authenticated user.',
            outputSchema: { characters: z.array(characterSchema)},
        },
        async () => {
            const characters = await destinyController.getCharacters(user.displayName, user.membershipType);
            const validation = z.array(characterSchema).safeParse(characters);

            if (!validation.success) {
                throw new Error('Validation of character list failed');
            }

            return {
                content: [{ type: 'text', text: `Retrieved ${characters.length} characters.` }],
                structuredContent: { characters }
            };
        }
    );

    server.registerTool(
        'get-xur-inventory-for-character',
        {
            title: 'Get Xur\'s Inventory for a Character',
            description: 'Return the list of items Xur is selling for a character.',
            inputSchema: { characterId: z.string() },
            outputSchema: { items: z.array(itemSchema)},
        },
        async ({ characterId }) => {
            const items = await destinyController.getXur(user.displayName, user.membershipType, characterId);
            const validation = z.array(itemSchema).safeParse(items);
            if (!validation.success) {
                throw new Error('Validation of character list failed');
            }

            return {
                content: [{ type: 'text', text: `Retrieved ${items.length} items.` }],
                structuredContent: { items }
            };
        }
    );

    return server;
}
