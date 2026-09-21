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

    describe('the consent guard', () => {
        /**
         * The guard exists because of the wait for a limiter slot, so what
         * matters is that it is consulted *inside* the slot and not before it.
         * A limiter that defers forever must never reach the guard.
         */
        it('checks the guard only once the limiter slot is granted', async () => {
            const guard = vi.fn().mockResolvedValue(true);

            limiter.schedule.mockImplementation(() => Promise.resolve('deferred'));

            await notificationService.sendMessage('Aegis of the Reef', '+11111111111', undefined, {
                guard,
            });

            expect(guard).not.toHaveBeenCalled();
            expect(client.messages.create).not.toHaveBeenCalled();
        });

        it('does not call Twilio when the guard withholds the send', async () => {
            const guard = vi.fn().mockResolvedValue(false);

            const result = await notificationService.sendMessage(
                'Aegis of the Reef',
                '+11111111111',
                undefined,
                { guard },
            );

            expect(limiter.schedule).toHaveBeenCalledTimes(1);
            expect(guard).toHaveBeenCalledTimes(1);
            expect(client.messages.create).not.toHaveBeenCalled();
            expect(result).toBeUndefined();
        });

        it('calls Twilio when the guard permits the send', async () => {
            const guard = vi.fn().mockResolvedValue(true);

            const result = await notificationService.sendMessage(
                'Aegis of the Reef',
                '+11111111111',
                undefined,
                { guard },
            );

            expect(guard).toHaveBeenCalledTimes(1);
            expect(client.messages.create).toHaveBeenCalledTimes(1);
            expect(result).toBe(mockTwilioCreateMessageResponse);
        });

        it('leaves a send with no guard ungated', async () => {
            await notificationService.sendMessage('Your code is 1234', '+11111111111');

            expect(client.messages.create).toHaveBeenCalledTimes(1);
        });
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
