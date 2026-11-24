import { describe, expect, it } from 'vitest';
import clientIp, { clientNetwork } from './client-ip.js';

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

describe('clientNetwork()', () => {
    it.each([
        ['207.175.165.55:60926', '207.175.165.55'],
        ['2001:db8::1', '2001:db8:0:0::/64'],
        ['[2001:0DB8:0000:0001:aaaa::1]:443', '2001:db8:0:1::/64'],
        ['2001:db8:85a3:8d3:1319:8a2e:370:7348', '2001:db8:85a3:8d3::/64'],
        ['fe80::1%en0', 'fe80:0:0:0::/64'],
        ['::1', '0:0:0:0::/64'],
        ['::', '0:0:0:0::/64'],
        ['64:ff9b::192.0.2.33', '64:ff9b:0:0::/64'],
        ['::ffff:169.254.131.1', '169.254.131.1'],
        ['::ffff:a9fe:8301', '169.254.131.1'],
        ['', ''],
        ['unknown', 'unknown'],
    ])('should read %j as %j', (ip, expected) => {
        expect(clientNetwork({ ip })).toBe(expected);
    });

    it('should give every address in one IPv6 /64 the same key', () => {
        const keys = ['2001:db8:0:1::1', '2001:db8:0:1::2', '[2001:db8:0:1:ffff::]:443'].map(ip =>
            clientNetwork({ ip }),
        );

        expect(new Set(keys).size).toBe(1);
    });

    it('should keep neighbouring IPv6 /64s apart', () => {
        expect(clientNetwork({ ip: '2001:db8:0:1::1' })).not.toBe(
            clientNetwork({ ip: '2001:db8:0:2::1' }),
        );
    });
});
