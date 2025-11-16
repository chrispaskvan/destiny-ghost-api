import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router } from 'express';
import { createId } from '@paralleldrive/cuid2';
import authorizeUser from '../authorization/authorization.middleware.js';
import { createMcpServer } from './mcp.server.js';
import configuration from '../helpers/config.js';
import log from '../helpers/log.js';

const routes = ({
    destinyController,
}) => {
    const mcpRouter = Router();
    const sessions = new Map();

    mcpRouter.post('/', authorizeUser, async (req, res) => {
        let sessionId = req.headers['mcp-session-id'];
        const sessionData = sessions.get(sessionId);

        if (sessionData) {
            const { transport } = sessionData;

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
