import { describe, expect, it } from 'vitest';
import clientIp from './client-ip.js';

describe('clientIp()', () => {
    it.each([
        ['207.175.165.55:60926', '207.175.165.55'],
        ['207.175.165.55', '207.175.165.55'],
        ['[2001:db8::1]:443', '2001:db8::1'],
        ['[2001:db8::1]', '2001:db8::1'],
        ['2001:db8::1', '2001:db8::1'],
        ['::ffff:169.254.131.1', '::ffff:169.254.131.1'],
        ['::1', '::1'],
    ])('should read %j as %j', (ip, expected) => {
        expect(clientIp({ ip })).toBe(expected);
    });

    it('should give every connection from one client the same key', () => {
        const keys = ['207.175.165.55:60926', '207.175.165.55:32774'].map(ip => clientIp({ ip }));

        expect(new Set(keys).size).toBe(1);
    });

    it('should fall back to an empty key when the address is unknown', () => {
        expect(clientIp({})).toBe('');
    });
});
