// @ts-check
import { isIPv6 } from 'node:net';

/**
 * The client's address without the port, for keying per-client state.
 *
 * Azure App Service's front end forwards the client as `ip:port` in
 * X-Forwarded-For (e.g. `207.175.165.55:60926`), and with `trust proxy` set
 * Express hands that through as `req.ip` unchanged. Keyed on that, every new
 * connection from the same client gets its own rate-limit bucket.
 *
 * @module client-ip
 */

const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d+)?$/;

/**
 * @param {Pick<import('express').Request, 'ip'>} req
 * @returns {string} `req.ip` with any port removed. A bare IPv6 address is
 * returned as is: its colons are part of the address, so only the bracketed
 * form can carry a port.
 */
export default function clientIp({ ip = '' }) {
    return ip.match(IPV4_WITH_PORT)?.[1] ?? ip.match(BRACKETED_IPV6)?.[1] ?? ip;
}

/**
 * The client's network, for limits a sender must not escape by changing
 * address. An IPv4 client is its address. An IPv6 client is its /64: an
 * ordinary home or VPS allocation hands out a whole /64, so keyed on the full
 * address a sender could pick a fresh bucket for every request.
 *
 * @param {Pick<import('express').Request, 'ip'>} req
 * @returns {string} The IPv4 address (IPv4-mapped IPv6 included), the IPv6
 * /64 prefix as `2001:db8:0:1::/64`, or the address as is when it is neither.
 */
export function clientNetwork(req) {
    const address = clientIp(req);
    const [host] = address.split('%');

    if (!isIPv6(host)) return address;

    const groups = expandIPv6(host);
    const mapped = groups.slice(0, 6).join(':') === '0:0:0:0:0:ffff';

    if (mapped) {
        const [high, low] = groups.slice(6).map(group => parseInt(group, 16));

        return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
    }

    return `${groups.slice(0, 4).join(':')}::/64`;
}

/**
 * @param {string} address A valid IPv6 address without a zone.
 * @returns {string[]} Its eight groups, in lowercase without leading zeros.
 */
function expandIPv6(address) {
    // A trailing dotted quad (e.g. `::ffff:192.0.2.1`) stands for the last two groups.
    const dotted = address.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    let hex = address;

    if (dotted) {
        const [prefix, a, b, c, d] = [dotted[1], ...dotted.slice(2).map(Number)];

        hex = `${prefix}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }

    const [head, tail] = hex.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const zeros = tail === undefined ? [] : Array(8 - left.length - right.length).fill('0');

    return [...left, ...zeros, ...right].map(group => parseInt(group, 16).toString(16));
}
