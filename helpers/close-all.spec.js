import { describe, expect, it } from 'vitest';
import closeAll from './close-all.js';

describe('closeAll', () => {
    it('should resolve when every close resolves', async () => {
        await expect(
            closeAll([Promise.resolve(), Promise.resolve()], 'closing'),
        ).resolves.toBeUndefined();
    });

    it('should not settle on a failure while another close is still pending', async () => {
        const pending = Promise.withResolvers();
        const err = new Error('close failed');
        let settled = false;

        const closing = closeAll([Promise.reject(err), pending.promise], 'closing').catch(
            reason => {
                settled = true;
                return reason;
            },
        );

        await new Promise(resolve => setImmediate(resolve));
        expect(settled).toBe(false);

        pending.resolve();
        const reason = await closing;

        expect(settled).toBe(true);
        expect(reason).toBeInstanceOf(AggregateError);
        expect(reason.message).toBe('closing');
        expect(reason.errors).toEqual([err]);
    });

    it('should report every failure', async () => {
        const first = new Error('first');
        const second = new Error('second');

        await expect(
            closeAll([Promise.reject(first), Promise.reject(second)], 'closing'),
        ).rejects.toMatchObject({ errors: [first, second] });
    });
});
