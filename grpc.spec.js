import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import grpc from '@grpc/grpc-js';
import { createGetAllHandler } from './grpc.js';

vi.mock('./helpers/config.js', () => ({
    default: {
        notificationHeaders: { 'x-test-header': 'test-value' },
    },
}));
vi.mock('./helpers/pool.js', () => ({ default: {} }));
vi.mock('./helpers/world2.js', () => ({ default: vi.fn() }));

const createCall = ({ headerValue = 'test-value', page = null, size = null } = {}) => ({
    metadata: {
        get: (key) => (key === 'x-test-header' ? [headerValue] : []),
    },
    request: { page, size },
});

describe('createGetAllHandler', () => {
    let callback;
    let world;

    beforeEach(() => {
        callback = vi.fn();
        world = { items: Array.from({ length: 33 }, (_, i) => ({ hash: i })) };
    });

    describe('authentication', () => {
        it('returns UNAUTHENTICATED when header value is wrong', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ headerValue: 'wrong' }), callback);

            expect(callback).toHaveBeenCalledWith({ code: grpc.status.UNAUTHENTICATED });
        });
    });

    describe('world not ready', () => {
        it('returns UNAVAILABLE when items is undefined', () => {
            const handler = createGetAllHandler({ items: undefined });

            handler(createCall(), callback);

            expect(callback).toHaveBeenCalledWith({ code: grpc.status.UNAVAILABLE });
        });

        it('returns UNAVAILABLE when items is empty', () => {
            const handler = createGetAllHandler({ items: [] });

            handler(createCall(), callback);

            expect(callback).toHaveBeenCalledWith({ code: grpc.status.UNAVAILABLE });
        });
    });

    describe('parameter validation', () => {
        it('returns INVALID_ARGUMENT when page is 0', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 0 }), callback);

            expect(callback).toHaveBeenCalledWith({ code: grpc.status.INVALID_ARGUMENT });
        });

        it('returns INVALID_ARGUMENT when size is 0', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ size: 0 }), callback);

            expect(callback).toHaveBeenCalledWith({ code: grpc.status.INVALID_ARGUMENT });
        });

        it('returns OUT_OF_RANGE when page exceeds total pages', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 999, size: 10 }), callback);

            expect(callback).toHaveBeenCalledWith({ code: grpc.status.OUT_OF_RANGE });
        });
    });

    describe('pagination', () => {
        it('defaults to page 1, size 11 when request fields are null', () => {
            const handler = createGetAllHandler(world);

            handler(createCall(), callback);

            const [, response] = callback.mock.calls[0];

            expect(response.page.number).toBe(1);
            expect(response.page.size).toBe(11);
            expect(response.data).toHaveLength(11);
        });

        it('returns the correct slice for a given page', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 2, size: 10 }), callback);

            const [, response] = callback.mock.calls[0];

            expect(response.data[0].hash).toBe(10);
            expect(response.data).toHaveLength(10);
        });

        it('sets links.next to the next page number when more pages exist', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 1, size: 10 }), callback);

            const [, response] = callback.mock.calls[0];

            expect(response.links.next).toBe('2');
        });

        it('sets links.next to empty string on the last page', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 4, size: 10 }), callback);

            const [, response] = callback.mock.calls[0];

            expect(response.links.next).toBe('');
        });

        it('returns correct page metadata', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 2, size: 10 }), callback);

            const [, response] = callback.mock.calls[0];

            expect(response.page).toEqual({
                size: 10,
                total: 33,
                pages: 4,
                number: 2,
            });
        });
    });
});
