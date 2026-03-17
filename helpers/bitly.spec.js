/**
 * Bitly Tests
 */
import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('./config', () => ({
    default: {
        bitly: {
            accessToken: 'test-access-token',
        },
    },
}));

vi.mock('./request', () => ({
    post: vi.fn(),
}));

describe('Bitly', () => {
    let getShortUrl;
    let mockPost;

    beforeEach(async () => {
        vi.clearAllMocks();

        const bitlyModule = await import('./bitly');
        const requestModule = await import('./request');

        getShortUrl = bitlyModule.default;
        mockPost = requestModule.post;
    });

    describe('getShortUrl', () => {
        it('should return a short URL', async () => {
            mockPost.mockResolvedValue({ link: 'https://bit.ly/abc123' });

            const url = await getShortUrl('http://db.planetdestiny.com/items/view/3164616404');

            expect(url).toBe('https://bit.ly/abc123');
            expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({
                url: 'https://api-ssl.bitly.com/v4/shorten',
                data: {
                    domain: 'bit.ly',
                    group_id: '',
                    long_url: 'http://db.planetdestiny.com/items/view/3164616404',
                },
                headers: {
                    Authorization: 'Bearer test-access-token',
                },
            }));
        });

        it('should reject when URL is not a string', async () => {
            await expect(getShortUrl()).rejects.toThrow('URL is not a string');

            expect(mockPost).not.toHaveBeenCalled();
        });
    });
});
