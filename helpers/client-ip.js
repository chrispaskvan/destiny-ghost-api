// @ts-check
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
