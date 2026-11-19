import { beforeEach, describe, expect, it, vi } from 'vitest';

const { read } = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('../helpers/dispatch-record.js', () => ({ default: { read } }));
vi.mock('../helpers/log.js', () => ({ default: { warn: vi.fn() } }));

import log from '../helpers/log.js';
import SendDeferredError from './send-deferred.error.js';
import { isA, outcomeUnknown, recordOfSend } from './send-outcome.js';
import SendOutcomeUnknownError from './send-outcome-unknown.error.js';

describe('send outcome', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('isA', () => {
        it('should match an instance of the type', () => {
            expect(isA(new SendOutcomeUnknownError('lost'), SendOutcomeUnknownError)).toBe(true);
        });

        it('should match one from another copy of the module, by name', () => {
            const copy = Object.assign(new Error('lost'), { name: 'SendOutcomeUnknownError' });

            expect(isA(copy, SendOutcomeUnknownError)).toBe(true);
        });

        it('should not match another type', () => {
            expect(isA(new SendDeferredError('held'), SendOutcomeUnknownError)).toBe(false);
            expect(isA(undefined, SendOutcomeUnknownError)).toBe(false);
        });
    });

    describe('outcomeUnknown', () => {
        it.each([
            ['the last error says so', new SendOutcomeUnknownError('lost'), null, true],
            ['the record is still attempting', new Error('stalled'), { state: 'attempting' }, true],
            ['Twilio took it', new Error('stalled'), { state: 'accepted', sid: 'SM1' }, false],
            ['nothing was attempted', new Error('stalled'), null, false],
        ])('should be %s', (_label, err, record, expected) => {
            expect(outcomeUnknown(err, record)).toBe(expected);
        });
    });

    describe('recordOfSend', () => {
        it('should read the record of the send', async () => {
            read.mockResolvedValueOnce({ state: 'accepted', sid: 'SM1' });

            await expect(recordOfSend('cc-1', '+15005550006')).resolves.toEqual({
                state: 'accepted',
                sid: 'SM1',
            });
            expect(read).toHaveBeenCalledWith('cc-1', '+15005550006');
        });

        it('should answer null, and say so, when the record cannot be read', async () => {
            read.mockRejectedValueOnce(new Error('Redis unavailable'));

            await expect(recordOfSend('cc-1', '+15005550006')).resolves.toBeNull();
            expect(log.warn).toHaveBeenCalledOnce();
        });
    });
});
