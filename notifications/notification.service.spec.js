import { beforeEach, describe, expect, it, vi } from 'vitest';
import mockTwilioCreateMessageResponse from '../mocks/twilioCreateMessageResponse.json';
import Notifications from './notification.service.js';
import { withRetry, isTransientError } from '../helpers/retry.js';

vi.mock('../helpers/retry.js', () => ({
    withRetry: vi.fn(fn => fn()),
    isTransientError: vi.fn(),
}));
vi.mock('../helpers/twilio-rate-limiter.js', () => ({
    default: { schedule: vi.fn(fn => fn()) },
}));

const client = {
    messages: {
        create: vi.fn(() => Promise.resolve(mockTwilioCreateMessageResponse)),
    },
};
const limiter = {
    schedule: vi.fn(fn => fn()),
};

let notificationService;

beforeEach(() => {
    vi.clearAllMocks();
    client.messages.create.mockResolvedValue(mockTwilioCreateMessageResponse);
    limiter.schedule.mockImplementation(fn => fn());
    notificationService = new Notifications({ client, limiter });
});

describe('Notifications', () => {
    it('schedules the Twilio send through the injected rate limiter', async () => {
        await notificationService.sendMessage('Aegis of the Reef', '+11111111111');

        expect(limiter.schedule).toHaveBeenCalledTimes(1);
        expect(client.messages.create).toHaveBeenCalledTimes(1);
    });

    it('does not call Twilio directly if the limiter never invokes the scheduled function', async () => {
        limiter.schedule.mockImplementation(() => Promise.resolve('deferred'));

        const result = await notificationService.sendMessage('Aegis of the Reef', '+11111111111');

        expect(client.messages.create).not.toHaveBeenCalled();
        expect(result).toBe('deferred');
    });

    it('wraps sendMessage with retry using isTransientError', async () => {
        await notificationService.sendMessage('Aegis of the Reef', '+11111111111');

        expect(withRetry).toHaveBeenCalledWith(expect.any(Function), {
            shouldRetry: isTransientError,
            maxRetries: 0,
        });
    });

    it('sendMessage', async () => {
        const { sid, dateCreated, status } = await notificationService.sendMessage(
            'Aegis of the Reef',
            '+11111111111',
        );

        expect(sid).toEqual(mockTwilioCreateMessageResponse.sid);
        expect(dateCreated).toEqual(mockTwilioCreateMessageResponse.dateCreated);
        expect(status).toEqual(mockTwilioCreateMessageResponse.status);
    });

    it('prefixes the message body with the brand name for carrier compliance', async () => {
        await notificationService.sendMessage('Aegis of the Reef', '+11111111111');

        expect(client.messages.create).toHaveBeenCalledWith(
            expect.objectContaining({ body: 'Destiny-Ghost: Aegis of the Reef' }),
        );
    });
});
