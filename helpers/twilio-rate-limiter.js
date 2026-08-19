import Bottleneck from 'bottleneck';
import configuration from './config.js';
import log from './log.js';

const { redis = {} } = configuration;

/**
 * Twilio Send Rate Limiter
 * @description Cluster-aware rate limiter for outbound Twilio messages, backed by Redis so the
 * limit is enforced across every horizontally scaled instance of this service rather than per
 * process. This replaces the in-memory p-throttle limiter, which only ever throttled how fast
 * jobs were enqueued to BullMQ — not the actual Twilio API calls, which is the resource with a
 * real account-level rate limit.
 *
 * IMPORTANT: The minTime below (250ms => ~4 messages/sec) simply carries forward the same
 * effective rate as the previous p-throttle config ({ limit: 2, interval: 500 }). That number
 * was never validated against this Twilio account's actual throughput (which depends on
 * Brand/Campaign type and Trust Score for A2P 10DLC — see
 * https://help.twilio.com/articles/1260803225669). Confirm the real limit and adjust minTime
 * before relying on this in production.
 *
 * @see {@link https://github.com/SGrondin/bottleneck#redis}
 */
const limiter = new Bottleneck({
    id: 'twilio-send-limiter',
    datastore: 'ioredis',
    clientOptions: {
        maxRetriesPerRequest: 0,
        ...redis,
        // Pin RESP2 to match the production Redis deployment (see helpers/jobs.js).
        protocol: 2,
    },
    minTime: 250,
    maxConcurrent: 1,
});

limiter.on('error', err => log.error({ err }, 'Twilio rate limiter connection failed.'));

export default limiter;
