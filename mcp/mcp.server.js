import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Factory to create and configure a new McpServer.
 * This factory is context-aware. It accepts dependencies like services and the
 * authenticated user object, making them available to all registered tools.
 *
 * @param {object} deps - The dependencies for the server.
 * @param {object} deps.destiny2Service - The Destiny 2 service instance.
 * @param {object} deps.user - The authenticated user object for this session.
 * @returns {McpServer} A new McpServer instance configured for the given user.
 */

export function createMcpServer({
    destinyService,
    user
}) {
    const server = new McpServer({
        name: 'destiny-ghost',
        version: process.env.npm_package_version
    });

    server.registerTool(
        'get-Characters',
        {
            title: 'Get Characters',
            description: 'Fetch the characters for the authenticated user.',
            outputSchema: { characters: z.array(z.object({
                characterId: z.string(),
                classHash: z.number(),
                powerLevel: z.number(),
            }))},
        },
        async () => {
            const characters = await destinyService.getCharacters(user.membershipId, user.membershipType);
            const formattedCharacters = characters.map(({ characterBase }) => ({
                characterId: characterBase.characterId,
                classHash: characterBase.classHash,
                powerLevel: characterBase.powerLevel,
            }));

            // let's use zod to validate the formattedCharacters before returning
            const validation = z.array(z.object({
                characterId: z.string(),
                classHash: z.number(),
                powerLevel: z.number(),
            })).safeParse(formattedCharacters);

            if (!validation.success) {
                throw new Error('Validation failed for formattedCharacters');
            }

            return {
                content: [{ type: 'text', text: `Retrieved ${characters.length} characters.` }],
                structuredContent: { characters: formattedCharacters }
            };
        }
    );

    return server;
}
