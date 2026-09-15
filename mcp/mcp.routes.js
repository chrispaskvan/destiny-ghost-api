// @ts-check
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router } from 'express';
import { createId } from '@paralleldrive/cuid2';
import { LRUCache as LruCache } from 'lru-cache';
import authorizeUser from '../authorization/authorization.middleware.js';
import { createMcpServer } from './mcp.server.js';
import configuration from '../helpers/config.js';
import log from '../helpers/log.js';

/**
 * @typedef {Object} McpRoutesOptions
 * @property {import('../destiny2/destiny2.controller.js').default} destinyController
 */

/**
 * @typedef {Object} SessionData
 * @property {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @property {StreamableHTTPServerTransport} transport
 */

/**
 * @param {McpRoutesOptions} options
 * @returns {import('express').Router}
 */
const routes = ({ destinyController }) => {
    const mcpRouter = Router();
    /** @type {LruCache<string, SessionData>} */
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
        const rawSessionId = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(rawSessionId)
            ? (rawSessionId[0] ?? '')
            : (rawSessionId ?? '');
        const sessionData = sessions.get(sessionId);

        if (sessionData) {
            const { transport } = sessionData;

            sessions.set(sessionId, sessionData); // Refresh the session's TTL on each request

            return transport.handleRequest(req, res, req.body);
        }

        const administrator = configuration.administrators[0];
        const user = await destinyController.getCurrentUser(
            administrator.displayName,
            administrator.membershipType,
        );
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
