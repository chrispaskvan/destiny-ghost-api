import {
    describe, it, expect, vi,
} from 'vitest';
import subscriber from './subscriber';

vi.mock('bullmq', () => ({
    Worker: vi.fn().mockImplementation(() => ({
        close: vi.fn().mockResolvedValue(),
        run: vi.fn().mockResolvedValue('some-worker'),
    })),
}));

describe('Subscriber', () => {
    describe('when a new worker is created', () => {
        it('should return a new worker', async () => {
            const result = await subscriber.listen();

            expect(result).toBe('some-worker');
        });
    });
});
