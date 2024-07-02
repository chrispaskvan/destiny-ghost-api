import {
    describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';

vi.mock('bullmq', () => ({
    Queue: vi.fn().mockImplementation(() => ({
        add: vi.fn().mockResolvedValue('some-job'),
    })),
}));

// eslint-disable-next-line import/first
import publisher from './publisher';

const chance = new Chance();

describe('Publisher', () => {
    describe('sendNotification', () => {
        it('should send a notification to a user', async () => {
            const user = {
                name: chance.name(),
                email: chance.email(),
            };
            const result = await publisher.sendNotification(user, { notificationType: 'Xur', claimCheckNumber: '11' });

            expect(result).toBe('some-job');
        });
    });
});
