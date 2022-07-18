/**
 * Bitly Tests
 */
import {
    describe, expect, it,
} from 'vitest';
import bitly from './bitly';

describe.skip('Bitly', () => {
    describe('getShortUrl', () => {
        it('should return a short URL', async () => bitly
            .getShortUrl('http://db.planetdestiny.com/items/view/3164616404')
            .then(url => {
                expect(url).toBeDefined();
            }));

        it('should not return a short URL', async () => expect(bitly.getShortUrl())
            .rejects.toThrow('URL is not a string'));
    });
});
