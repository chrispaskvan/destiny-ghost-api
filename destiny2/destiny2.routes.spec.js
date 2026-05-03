import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import Chance from 'chance';
import { createResponse, createRequest } from 'node-mocks-http';

import Destiny2Router from './destiny2.routes.js';
import Destiny2Controller from './destiny2.controller.js';
import manifest2Response from '../mocks/manifest2Response.json';
import configuration from '../helpers/config.js';

const { Response: manifest } = manifest2Response;
const chance = new Chance();
const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });
const authenticationController = {
    authenticate: vi.fn(() => ({
        displayName,
        membershipType,
    })),
};
const destiny2Service = {
    getManifest: () => Promise.resolve(manifest),
    getProfile: () => Promise.resolve(),
};
const userService = {
    getUserByDisplayName: vi.fn(() => Promise.resolve()),
};
const world = {
    getClassByHash: vi.fn(() => ({
        classType: 1,
        displayProperties: {
            name: 'Hunter',
            hasIcon: false,
        },
        genderedClassNames: {
            Male: 'Hunter',
            Female: 'Hunter',
        },
        hash: '671679327',
        index: 1,
        redacted: false,
    })),
};
const destiny2Controller = new Destiny2Controller({
    destinyService: destiny2Service,
    userService,
    worldRepository: world,
});

let destiny2Router;

beforeEach(() => {
    destiny2Router = Destiny2Router({
        authenticationController,
        destiny2Controller,
    });
});

describe('Destiny2Router', () => {
    const next = vi.fn();
    let res;

    beforeEach(() => {
        res = createResponse({
            eventEmitter: EventEmitter,
        });
    });

    describe('getCharacters', () => {
        describe('when session displayName and membershipType are defined', () => {
            describe('when user and destiny services return a user', () => {
                it('should return list of characters', () =>
                    new Promise((done, reject) => {
                        const req = createRequest({
                            method: 'GET',
                            url: '/characters',
                            session: {
                                displayName,
                                membershipType,
                            },
                        });

                        destiny2Service.getProfile = vi.fn().mockResolvedValue([
                            {
                                characterId: '1111111111111111111',
                                classHash: '671679327',
                                light: 284,
                                links: [
                                    {
                                        rel: 'Character',
                                        href: '/characters/1111111111111111111',
                                    },
                                ],
                            },
                        ]);
                        userService.getUserByDisplayName = vi.fn().mockResolvedValue({
                            membershipId: '1',
                        });

                        res.on('end', () => {
                            const data = JSON.parse(res._getData());

                            try {
                                expect(res.statusCode).toEqual(StatusCodes.OK);
                                expect(data[0].className).toEqual('Hunter');
                                done();
                            } catch (err) {
                                reject(err);
                            }
                        });

                        destiny2Router(req, res, next);
                    }));
            });
        });

        describe('when session displayName and membershipType are not defined', () => {
            it('should respond with unauthorized', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/characters',
                        session: {},
                    });

                    authenticationController.authenticate = vi.fn().mockResolvedValue(undefined);
                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    destiny2Router(req, res, next);
                }));
        });
    });

    describe('getInventory', () => {
        it('should respond with unauthorized when notification headers are missing', () =>
            new Promise((done, reject) => {
                const req = createRequest({
                    method: 'GET',
                    url: '/inventory',
                    query: {},
                });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                destiny2Router(req, res, next);
            }));

        it('should wait for drain when the response stream applies backpressure', () =>
            new Promise((done, reject) => {
                const req = createRequest({
                    method: 'GET',
                    url: '/inventory',
                    query: {},
                    headers: configuration.notificationHeaders,
                });
                const originalWrite = res.write.bind(res);
                let writeCalls = 0;

                world.items = [
                    { hash: 1, displayProperties: { name: 'One' } },
                    { hash: 2, displayProperties: { name: 'Two' } },
                ];

                res.write = vi.fn(chunk => {
                    writeCalls += 1;
                    originalWrite(chunk);

                    if (writeCalls === 1) {
                        return false;
                    }

                    return true;
                });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.OK);
                        expect(res.write).toHaveBeenCalledTimes(3);
                        expect(JSON.parse(res._getData())).toEqual(world.items);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                destiny2Router(req, res, next);

                setImmediate(() => {
                    try {
                        expect(res.write).toHaveBeenCalledTimes(1);
                        res.emit('drain');
                    } catch (err) {
                        reject(err);
                    }
                });
            }));

        it('should stop streaming when the response closes while waiting for drain', () =>
            new Promise((done, reject) => {
                const req = createRequest({
                    method: 'GET',
                    url: '/inventory',
                    query: {},
                    headers: configuration.notificationHeaders,
                });
                const originalWrite = res.write.bind(res);
                let writeCalls = 0;

                world.items = [
                    { hash: 1, displayProperties: { name: 'One' } },
                    { hash: 2, displayProperties: { name: 'Two' } },
                ];

                res.write = vi.fn(chunk => {
                    writeCalls += 1;
                    originalWrite(chunk);

                    return writeCalls > 1;
                });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.OK);
                        expect(res.write).toHaveBeenCalledTimes(1);
                        expect(res._getData()).toEqual(`[${JSON.stringify(world.items[0])}`);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                destiny2Router(req, res, next);

                setImmediate(() => {
                    try {
                        expect(res.write).toHaveBeenCalledTimes(1);
                        res.emit('close');
                    } catch (err) {
                        reject(err);
                    }
                });
            }));

        it('should stop streaming when backpressure does not drain in time', async () => {
            vi.useFakeTimers();

            try {
                const req = createRequest({
                    method: 'GET',
                    url: '/inventory',
                    query: {},
                    headers: configuration.notificationHeaders,
                });
                const originalWrite = res.write.bind(res);
                const socket = new EventEmitter();

                world.items = [
                    { hash: 1, displayProperties: { name: 'One' } },
                    { hash: 2, displayProperties: { name: 'Two' } },
                ];
                socket.timeout = 5000;
                socket.setTimeout = vi.fn(ms => {
                    socket.timeout = ms;
                    clearTimeout(socket.timeoutId);

                    if (ms > 0) {
                        socket.timeoutId = setTimeout(() => {
                            socket.emit('timeout');
                        }, ms);
                    }
                });
                res.socket = socket;
                res.destroy = vi.fn(err => {
                    if (err) {
                        res.emit('error', err);
                    }
                    res.destroyed = true;
                    res.emit('close');
                });
                res.write = vi.fn(chunk => {
                    originalWrite(chunk);

                    return false;
                });

                const responseComplete = new Promise((resolve, reject) => {
                    res.on('close', resolve);
                    res.on('error', reject);
                });

                destiny2Router(req, res, next);
                await vi.advanceTimersByTimeAsync(30 * 1000);
                await responseComplete;

                expect(res.destroy).toHaveBeenCalledOnce();
                expect(res.destroy).toHaveBeenCalledWith();
                expect(socket.setTimeout).toHaveBeenNthCalledWith(1, 30 * 1000);
                expect(socket.setTimeout).toHaveBeenLastCalledWith(5000);
                expect(res.write).toHaveBeenCalledTimes(1);
                expect(res._getData()).toEqual(`[${JSON.stringify(world.items[0])}`);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
