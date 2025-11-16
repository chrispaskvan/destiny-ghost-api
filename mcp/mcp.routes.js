import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router } from 'express';
import { createId } from '@paralleldrive/cuid2';
import { LRUCache as LruCache } from 'lru-cache';
import authorizeUser from '../authorization/authorization.middleware.js';
import { createMcpServer } from './mcp.server.js';
import configuration from '../helpers/config.js';
import log from '../helpers/log.js';

const routes = ({
    destinyController,
}) => {
    const mcpRouter = Router();
    const sessions = new LruCache({
        dispose: (value, key) => {
            log.info({ sessionId: key }, 'Disposing session');
            if (value.transport) {
                value.transport.close();
            }
        },
        max: 11, // The maximum number of items to store in the cache
        ttl: 1000 * 60 * 60, // The time-to-live for each session in milliseconds (60 minutes)
    });

    mcpRouter.post('/', authorizeUser, async (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        const sessionData = sessions.get(sessionId);

        if (sessionData) {
            const { transport } = sessionData;

            sessions.set(sessionId, sessionData); // Refresh the session's TTL on each request

            return transport.handleRequest(req, res, req.body);
        }

        const administrator = configuration.administrators[0];
        const user = await destinyController.getCurrentUser(administrator.displayName, administrator.membershipType);
        const server = createMcpServer({
            destinyController,
            user,
        });
        const transport = new StreamableHTTPServerTransport({
            enableJsonResponse: true,
            onsessioninitialized: sessionId => {
                sessions.set(sessionId, { server, transport });

                log.info({ sessionId }, 'MCP session initialized');
            },
            onsessionclosed: sessionId => {
                sessions.delete(sessionId);
                log.info({ sessionId }, 'MCP session closed');
            },
            sessionIdGenerator: createId,
        });

        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            log.error({ err }, 'Error during MCP session initialization');
            if (!res.headersSent) {
                res.status(500).send('Failed to initialize MCP session');
            }
        }
    });

    return mcpRouter;
};

export default routes;
