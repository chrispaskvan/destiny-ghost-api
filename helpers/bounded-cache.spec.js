import { afterEach, describe, expect, it, vi } from 'vitest';
import boundedCommand from './bounded-cache.js';
import cache from './cache.js';

vi.mock('./cache.js', () => ({
    default: { withCommandOptions: vi.fn(options => ({ options })) },
}));

describe('boundedCommand', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('should resolve with what the command resolved with', async () => {
        await expect(boundedCommand(async () => 'OK', 1000, 'thing')).resolves.toBe('OK');
    });

    it('should send the command with the timeout, so one still unsent is dropped', async () => {
        const command = vi.fn(async () => 'OK');

        await boundedCommand(command, 750, 'thing');

        expect(cache.withCommandOptions).toHaveBeenCalledWith({ timeout: 750 });
        expect(command).toHaveBeenCalledWith({ options: { timeout: 750 } });
    });

    /**
     * For a write that is better late than never: the caller stops waiting,
     * but the command stays queued rather than being dropped.
     */
    it('should send on the bare client, with no command timeout, when told to keep it', async () => {
        const command = vi.fn(async () => 'OK');

        await boundedCommand(command, 750, 'thing', { keepUnsent: true });

        expect(cache.withCommandOptions).not.toHaveBeenCalled();
        expect(command).toHaveBeenCalledWith(cache);
    });

    it('should still stop waiting at the timeout when told to keep the command, saying it may yet land', async () => {
        vi.useFakeTimers();

        const waiting = expect(
            boundedCommand(() => new Promise(() => {}), 750, 'thing', { keepUnsent: true }),
        ).rejects.toMatchObject({
            message: expect.stringContaining('The thing did not answer within 750ms'),
            stillPending: true,
        });

        await vi.advanceTimersByTimeAsync(750);
        await waiting;
    });

    it('should not call a dropped command pending', async () => {
        vi.useFakeTimers();

        const waiting = boundedCommand(() => new Promise(() => {}), 750, 'thing').catch(e => e);

        await vi.advanceTimersByTimeAsync(750);
        expect(await waiting).not.toHaveProperty('stillPending');
    });

    /**
     * Nobody awaits a kept command after the timeout, so this is the only
     * way its failure is heard.
     */
    it.each([
        ['fails', true],
        ['lands', false],
    ])(
        'should report a kept command that %s after the timeout only if it fails',
        async (_, fails) => {
            vi.useFakeTimers();
            const onLateFailure = vi.fn();
            const err = new Error('client closed');
            let settle;
            const command = () =>
                new Promise((resolve, reject) => {
                    settle = () => (fails ? reject(err) : resolve('OK'));
                });

            const waiting = boundedCommand(command, 750, 'thing', {
                keepUnsent: true,
                onLateFailure,
            }).catch(() => {});

            await vi.advanceTimersByTimeAsync(750);
            await waiting;
            settle();
            await vi.advanceTimersByTimeAsync(0);

            if (fails) expect(onLateFailure).toHaveBeenCalledExactlyOnceWith(err);
            else expect(onLateFailure).not.toHaveBeenCalled();
        },
    );

    it("should reject with the command's own error", async () => {
        const err = new Error('down');

        await expect(
            boundedCommand(
                async () => {
                    throw err;
                },
                1000,
                'thing',
            ),
        ).rejects.toBe(err);
    });

    it('should reject when building the command throws', async () => {
        const err = new Error('closed');

        await expect(
            boundedCommand(
                () => {
                    throw err;
                },
                1000,
                'thing',
            ),
        ).rejects.toBe(err);
    });

    it('should reject, naming what was asked, once the timeout passes', async () => {
        vi.useFakeTimers();

        const waiting = expect(
            boundedCommand(() => new Promise(() => {}), 1000, 'dispatch record'),
        ).rejects.toThrow('The dispatch record did not answer within 1000ms.');

        await vi.advanceTimersByTimeAsync(1000);
        await waiting;
    });

    it('should not reject before the timeout passes', async () => {
        vi.useFakeTimers();
        let settled = false;

        boundedCommand(() => new Promise(() => {}), 1000, 'thing').catch(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(settled).toBe(true);
    });
});
