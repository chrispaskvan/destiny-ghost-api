import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router } from 'express';
import { createId } from '@paralleldrive/cuid2';
import authorizeUser from '../authorization/authorization.middleware.js';
import { createMcpServer } from './mcp.server.js';
import configuration from '../helpers/config.js';

const routes = ({
    userService,
    destinyService,
}) => {
    const mcpRouter = Router();
    // This Map will store the context for each active MCP session.
    // The key is the Mcp-Session-Id, the value is { server, transport }.
    const sessions = new Map();

    mcpRouter.post('/', authorizeUser, async (req, res) => {
        const reqSessionId = req.headers['mcp-session-id'];
        const sessionData = sessions.get(reqSessionId);

        if (sessionData) {
            // --- Existing Session ---
            // A session for this ID already exists. Use its transport to handle the request.
            const { transport } = sessionData;
            return transport.handleRequest(req, res, req.body);
        }

        // --- New Session Initialization ---
        // No session found, so this must be an 'initialize' request.
        // The `authorizeUser` middleware has already run and attached `req.user`.

        // 1. Create a new, user-specific McpServer instance.
        // We inject the user object here, making it available to all tool handlers.
        const administrator = configuration.administrators[0];
        const user = await userService.getUserByDisplayName(administrator.displayName, administrator.membershipType);
        const server = createMcpServer({
            destinyService,
            user
        });

        // 2. Create a new transport for this specific session.
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: createId,
            onsessioninitialized: newSessionId => {
                // Once the SDK initializes the session, store both the user-specific
                // server and its transport in our sessions map.
                sessions.set(newSessionId, { server, transport });
                console.log(`MCP Session Initialized and Stored: ${newSessionId}`);
            },
            onsessionclosed: closedSessionId => {
                // When the session closes, clean up to prevent memory leaks.
                sessions.delete(closedSessionId);
                console.log(`MCP Session Closed and Cleaned Up: ${closedSessionId}`);
            },
            enableJsonResponse: true
        });

        try {
            // 3. Connect the new server and transport.
            await server.connect(transport);

            // 4. Handle the initial 'initialize' request.
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            console.error('Error during MCP session initialization:', error);
            if (!res.headersSent) {
                res.status(500).send('Failed to initialize MCP session');
            }
        }
    });

    return mcpRouter;
};

export default routes;
