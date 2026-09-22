/**
 * Twilio Controller Tests
 *
 * The routes spec drives this class over HTTP and covers the webhook contract.
 * These are the units underneath it: the branches a signed request cannot
 * reach conveniently, and the ones that only ever ran incidentally.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import TwilioController from './twilio.controller.js';
import DestinyError from '../destiny/destiny.error.js';
import ClaimCheck from '../helpers/claim-check.js';
import getShortUrl from '../helpers/bitly.js';
import subscriber from '../helpers/subscriber.js';
import { recordConsent } from '../helpers/consent-marker.js';
import { enqueueConsentChange } from './consent.queue.js';
import {
    EMOJI_DEFAULT_REPLY,
    EMOJI_INTENT_REPLIES,
    HELP_REPLY,
    MEDIA_RECEIVED_REPLY,
    MEDIA_UNSUPPORTED_REPLY,
    START_REPLY,
    STOP_REPLY,
} from './twilio.constants.js';

vi.mock('../helpers/bitly.js', () => ({ default: vi.fn() }));
vi.mock('../helpers/claim-check.js', () => ({
    default: { updatePhoneNumber: vi.fn() },
}));
vi.mock('../helpers/consent-marker.js', () => ({ recordConsent: vi.fn() }));
vi.mock('../helpers/subscriber.js', () => ({ default: { listen: vi.fn() } }));
vi.mock('./consent.queue.js', () => ({
    enqueueConsentChange: vi.fn(),
    QUEUE_NAME: 'consent',
}));
vi.mock('../helpers/log.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const chance = new Chance();
const phoneNumber = chance.phone();
const accessToken = chance.string({ length: 20 });

const authenticationService = { authenticate: vi.fn() };
const destinyService = { getProfile: vi.fn(), getXur: vi.fn() };
const mmsService = { process: vi.fn() };
const userService = {
    addUserMessage: vi.fn(),
    getUserByPhoneNumber: vi.fn(),
    updateUserSubscription: vi.fn(),
};
const worldRepository = {
    getDamageTypeByHash: vi.fn(),
    getItemByHash: vi.fn(),
    getItemByName: vi.fn(),
    getItemCategory: vi.fn(),
    getWeaponCategory: vi.fn(),
};

/** A registered, subscribed sender. */
const registeredUser = () => ({
    phoneNumber,
    membershipId: '11',
    membershipType: 2,
    dateRegistered: '2026-01-01T00:00:00Z',
    type: 'mobile',
});

/** The webhook body shape `request()` reads. */
const inbound = (Body, overrides = {}) => ({
    From: phoneNumber,
    To: '+15005550001',
    Body,
    NumMedia: '0',
    ...overrides,
});

let twilioController;

beforeEach(() => {
    vi.clearAllMocks();
    userService.getUserByPhoneNumber.mockResolvedValue(registeredUser());
    userService.addUserMessage.mockResolvedValue(undefined);
    worldRepository.getItemByName.mockResolvedValue([]);
    twilioController = new TwilioController({
        authenticationService,
        destinyService,
        mmsService,
        userService,
        worldRepository,
    });
});

describe('TwilioController', () => {
    describe('the consent worker it subscribes', () => {
        it('should apply changes from the consent queue, one at a time', () => {
            expect(subscriber.listen).toHaveBeenCalledWith(
                expect.any(Function),
                'consent',
                // Ordering is settled by the watermark, not by concurrency,
                // but one at a time keeps the common case off its own toes.
                { concurrency: 1 },
            );
        });

        it('should route a queued change through applyConsent', async () => {
            const [handler] = subscriber.listen.mock.calls[0];
            const applyConsent = vi
                .spyOn(twilioController, 'applyConsent')
                .mockResolvedValue(undefined);

            await handler({ phoneNumber, isSubscribed: false, receivedAt: 1 });

            expect(applyConsent).toHaveBeenCalledWith(phoneNumber, false, 1);
        });
    });

    describe('compliance keywords', () => {
        it.each([
            ['stop', STOP_REPLY, false],
            ['STOP', STOP_REPLY, false],
            ['unsubscribe', STOP_REPLY, false],
            ['quit', STOP_REPLY, false],
            ['start', START_REPLY, true],
            ['yes', START_REPLY, true],
        ])('should answer %s and record the intent', async (keyword, reply, isSubscribed) => {
            const result = await twilioController.request({
                body: inbound(keyword),
                cookies: {},
            });

            expect(result.message).toBe(reply);
            expect(recordConsent).toHaveBeenCalledWith(
                phoneNumber,
                isSubscribed,
                expect.any(Number),
            );
        });

        it.each(['help', 'info'])('should answer %s without touching consent', async keyword => {
            const result = await twilioController.request({
                body: inbound(keyword),
                cookies: {},
            });

            expect(result.message).toBe(HELP_REPLY);
            expect(recordConsent).not.toHaveBeenCalled();
            expect(enqueueConsentChange).not.toHaveBeenCalled();
        });

        /**
         * Carrier compliance: these have to work for any inbound number, so
         * nothing about the sender may be looked up before answering.
         */
        it('should answer without looking the sender up at all', async () => {
            await twilioController.request({ body: inbound('STOP'), cookies: {} });

            expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
            expect(authenticationService.authenticate).not.toHaveBeenCalled();
        });

        it('should strip emoji before matching a keyword', async () => {
            const result = await twilioController.request({
                body: inbound('STOP 🔥'),
                cookies: {},
            });

            expect(result.message).toBe(STOP_REPLY);
        });

        it('should fall back to an inline write when the queue will not take it', async () => {
            enqueueConsentChange.mockRejectedValue(new Error('queue unavailable'));

            await twilioController.request({ body: inbound('STOP'), cookies: {} });
            await new Promise(resolve => setImmediate(resolve));

            expect(userService.updateUserSubscription).toHaveBeenCalled();
        });
    });

    describe('applyConsent', () => {
        it('should do nothing when the number matches no account', async () => {
            userService.getUserByPhoneNumber.mockResolvedValue(undefined);

            await twilioController.applyConsent(phoneNumber, false, 1000);

            expect(userService.updateUserSubscription).not.toHaveBeenCalled();
        });

        it('should read past the cache so the etag is the current one', async () => {
            await twilioController.applyConsent(phoneNumber, false, 1000);

            expect(userService.getUserByPhoneNumber).toHaveBeenCalledWith(phoneNumber, true);
        });

        it('should discard an intent a newer one has already superseded', async () => {
            userService.getUserByPhoneNumber.mockResolvedValue({
                ...registeredUser(),
                consentUpdatedAt: 2000,
            });

            await twilioController.applyConsent(phoneNumber, false, 1000);

            expect(userService.updateUserSubscription).not.toHaveBeenCalled();
        });

        /** Two messages sharing a millisecond cannot be ordered by arrival. */
        it('should apply an intent that ties with what is stored', async () => {
            userService.getUserByPhoneNumber.mockResolvedValue({
                ...registeredUser(),
                consentUpdatedAt: 1000,
            });

            await twilioController.applyConsent(phoneNumber, false, 1000);

            expect(userService.updateUserSubscription).toHaveBeenCalled();
        });

        it('should retry a write Cosmos rejected on a superseded etag', async () => {
            userService.updateUserSubscription
                .mockRejectedValueOnce(Object.assign(new Error('precondition'), { code: 412 }))
                .mockResolvedValue(undefined);

            await twilioController.applyConsent(phoneNumber, false, 1000);

            expect(userService.updateUserSubscription).toHaveBeenCalledTimes(2);
        });

        it('should not retry a fault repeating cannot fix', async () => {
            userService.updateUserSubscription.mockRejectedValue(
                Object.assign(new Error('bad request'), { code: 400 }),
            );

            await expect(twilioController.applyConsent(phoneNumber, false, 1000)).rejects.toThrow();
            expect(userService.updateUserSubscription).toHaveBeenCalledTimes(1);
        });

        /**
         * The rejection is what lets the queue worker hand the job back;
         * swallowing it would mark every job completed and drop the change.
         */
        it('should reject once the retries are spent', async () => {
            // Exponential backoff over five retries is ~15s of real waiting.
            vi.useFakeTimers();
            userService.updateUserSubscription.mockRejectedValue(
                Object.assign(new Error('throttled'), { code: 429 }),
            );

            try {
                const applying = twilioController.applyConsent(phoneNumber, false, 1000);
                const rejects = expect(applying).rejects.toThrow();

                await vi.runAllTimersAsync();
                await rejects;

                // The first attempt plus CONSENT_WRITE_RETRIES more.
                expect(userService.updateUserSubscription).toHaveBeenCalledTimes(6);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('request', () => {
        it('should say nothing at all to a sender who opted out', async () => {
            userService.getUserByPhoneNumber.mockResolvedValue({
                ...registeredUser(),
                isSubscribed: false,
            });

            await expect(
                twilioController.request({ body: inbound('gjallarhorn'), cookies: {} }),
            ).resolves.toEqual({});
        });

        it('should point an unregistered sender at registration', async () => {
            userService.getUserByPhoneNumber.mockResolvedValue(undefined);

            const { message } = await twilioController.request({
                body: inbound('gjallarhorn'),
                cookies: {},
            });

            expect(message).toContain('/register');
        });

        /** Already told once, and the cookie says so. */
        it('should stay quiet for an unregistered sender it has already told', async () => {
            userService.getUserByPhoneNumber.mockResolvedValue(undefined);

            await expect(
                twilioController.request({
                    body: inbound('gjallarhorn'),
                    cookies: { isRegistered: 'true' },
                }),
            ).resolves.toEqual({});
        });

        it('should record an inbound message from a registered sender', async () => {
            const body = inbound('gjallarhorn');

            await twilioController.request({ body, cookies: {} });

            expect(userService.addUserMessage).toHaveBeenCalledWith(body);
        });

        describe('media', () => {
            it('should hand images off for analysis', async () => {
                const body = inbound('', {
                    NumMedia: '1',
                    MediaContentType0: 'image/jpeg',
                    MediaUrl0: 'https://api.twilio.com/media/ME1',
                });

                const { message } = await twilioController.request({ body, cookies: {} });

                expect(message).toBe(MEDIA_RECEIVED_REPLY);
                expect(mmsService.process).toHaveBeenCalledWith({
                    from: phoneNumber,
                    media: [{ contentType: 'image/jpeg', url: 'https://api.twilio.com/media/ME1' }],
                });
            });

            /**
             * Downloading and analysing an image can outlast Twilio's webhook
             * timeout, so the handoff is deliberately not awaited. Proving
             * that needs the analysis left outstanding while the reply is
             * asked for: a test that only checks `process` was called passes
             * just as well when the source awaits it, because the double
             * settles immediately.
             */
            it('should acknowledge while the analysis is still running', async () => {
                const analysing = Promise.withResolvers();
                const body = inbound('', {
                    NumMedia: '1',
                    MediaContentType0: 'image/jpeg',
                    MediaUrl0: 'https://api.twilio.com/media/ME1',
                });

                mmsService.process.mockReturnValueOnce(analysing.promise);

                try {
                    const { message } = await twilioController.request({ body, cookies: {} });

                    expect(message).toBe(MEDIA_RECEIVED_REPLY);
                } finally {
                    analysing.resolve(undefined);
                }
            });

            it('should refuse an attachment that is not an image', async () => {
                const body = inbound('', {
                    NumMedia: '1',
                    MediaContentType0: 'application/pdf',
                    MediaUrl0: 'https://api.twilio.com/media/ME1',
                });

                const { message } = await twilioController.request({ body, cookies: {} });

                expect(message).toBe(MEDIA_UNSUPPORTED_REPLY);
                expect(mmsService.process).not.toHaveBeenCalled();
            });

            it('should keep only the image among mixed attachments', async () => {
                const body = inbound('', {
                    NumMedia: '2',
                    MediaContentType0: 'application/pdf',
                    MediaUrl0: 'https://api.twilio.com/media/ME1',
                    MediaContentType1: 'image/png',
                    MediaUrl1: 'https://api.twilio.com/media/ME2',
                });

                await twilioController.request({ body, cookies: {} });

                expect(mmsService.process).toHaveBeenCalledWith({
                    from: phoneNumber,
                    media: [{ contentType: 'image/png', url: 'https://api.twilio.com/media/ME2' }],
                });
            });
        });

        describe('emoji-only messages', () => {
            it.each([...EMOJI_INTENT_REPLIES.entries()])(
                'should answer %s with its mapped intent',
                async (emoji, reply) => {
                    const { message } = await twilioController.request({
                        body: inbound(emoji),
                        cookies: {},
                    });

                    expect(message).toBe(reply);
                    expect(worldRepository.getItemByName).not.toHaveBeenCalled();
                },
            );

            it('should answer an unmapped emoji with the default rather than searching', async () => {
                const { message } = await twilioController.request({
                    body: inbound('🦄'),
                    cookies: {},
                });

                expect(message).toBe(EMOJI_DEFAULT_REPLY);
                expect(worldRepository.getItemByName).not.toHaveBeenCalled();
            });

            it('should still search when an emoji rides along with text', async () => {
                await twilioController.request({ body: inbound('gjallarhorn 🔥'), cookies: {} });

                expect(worldRepository.getItemByName).toHaveBeenCalledWith('gjallarhorn');
            });
        });

        describe('the more keyword', () => {
            it('should shorten a light.gg link for the item last shown', async () => {
                getShortUrl.mockResolvedValue('https://bit.ly/abc');

                const { message } = await twilioController.request({
                    body: inbound('more'),
                    cookies: { itemHash: '1274330687' },
                });

                expect(getShortUrl).toHaveBeenCalledWith(
                    'https://www.light.gg/db/items/1274330687',
                );
                expect(message).toContain('https://bit.ly/abc');
            });

            it('should ask what, when no item has been shown yet', async () => {
                const { message } = await twilioController.request({
                    body: inbound('more'),
                    cookies: {},
                });

                expect(message).toBe('More what?');
                expect(getShortUrl).not.toHaveBeenCalled();
            });
        });

        describe('item search', () => {
            const weapon = (overrides = {}) => ({
                hash: 1274330687,
                itemName: 'Gjallarhorn',
                itemType: 3,
                displayProperties: { name: 'Gjallarhorn', icon: '/icon.png' },
                inventory: { tierTypeName: 'Exotic' },
                itemCategoryHashes: [5],
                itemTypeDisplayName: 'Rocket Launcher',
                ...overrides,
            });

            beforeEach(() => {
                worldRepository.getItemCategory.mockResolvedValue({
                    hash: 5,
                    shortTitle: 'Weapon',
                });
                worldRepository.getDamageTypeByHash.mockResolvedValue({
                    displayProperties: { name: 'Solar' },
                });
            });

            it('should apologise when nothing matches', async () => {
                const { message } = await twilioController.request({
                    body: inbound('nonsense'),
                    cookies: {},
                });

                expect(message).toEqual(expect.any(String));
                expect(message.length).toBeGreaterThan(0);
            });

            it('should answer a single match with its name, detail and icon', async () => {
                worldRepository.getItemByName.mockResolvedValue([weapon()]);

                const { message, media, cookies } = await twilioController.request({
                    body: inbound('gjallarhorn'),
                    cookies: {},
                });

                expect(message).toContain('Gjallarhorn');
                expect(media).toBe('https://www.bungie.net/icon.png');
                // Remembered so a following 'more' knows what it refers to.
                expect(cookies.itemHash).toBe('1274330687');
            });

            it('should withhold the icon from a landline', async () => {
                userService.getUserByPhoneNumber.mockResolvedValue({
                    ...registeredUser(),
                    type: 'landline',
                });
                worldRepository.getItemByName.mockResolvedValue([weapon()]);

                const { media } = await twilioController.request({
                    body: inbound('gjallarhorn'),
                    cookies: {},
                });

                expect(media).toBeUndefined();
            });

            it('should name the damage type when the item has one', async () => {
                worldRepository.getItemByName.mockResolvedValue([
                    weapon({ defaultDamageTypeHash: 1847026933 }),
                ]);

                const { message } = await twilioController.request({
                    body: inbound('gjallarhorn'),
                    cookies: {},
                });

                expect(message).toContain('Solar');
            });

            it('should leave the damage type out when the item has none', async () => {
                worldRepository.getItemByName.mockResolvedValue([weapon()]);

                const { message } = await twilioController.request({
                    body: inbound('gjallarhorn'),
                    cookies: {},
                });

                expect(worldRepository.getDamageTypeByHash).not.toHaveBeenCalled();
                expect(message).not.toContain('Solar');
            });

            it('should list distinct matches and forget the last item', async () => {
                worldRepository.getItemByName.mockResolvedValue([
                    weapon({ itemName: 'Ace of Spades', hash: 1 }),
                    weapon({ itemName: 'Last Word', hash: 2 }),
                ]);

                const { message, cookies } = await twilioController.request({
                    body: inbound('hand cannon'),
                    cookies: { itemHash: '999' },
                });

                expect(message).toContain('Ace of Spades');
                expect(message).toContain('Last Word');
                expect(cookies.itemHash).toBeUndefined();
            });

            /** Same weapon at several tiers is one answer, not a list. */
            it('should collapse duplicates of one name into a single detail', async () => {
                worldRepository.getItemByName.mockResolvedValue([
                    weapon({ hash: 1 }),
                    weapon({ hash: 2 }),
                ]);

                const { message } = await twilioController.request({
                    body: inbound('gjallarhorn'),
                    cookies: {},
                });

                expect(message).toContain('Gjallarhorn');
                expect(message).not.toMatch(/Gjallarhorn[\s\S]*Gjallarhorn/);
            });

            it('should ignore anything that is not a weapon or armour type', async () => {
                worldRepository.getItemByName.mockResolvedValue([weapon({ itemType: 19 })]);

                const { message } = await twilioController.request({
                    body: inbound('mod'),
                    cookies: {},
                });

                /**
                 * Asserted on the detail rather than the name: one of the
                 * no-results replies is "Does it look like a Gjallarhorn?",
                 * so matching the name would fail at random.
                 */
                expect(message).not.toContain('Rocket Launcher');
            });

            /**
             * `queryItem` drops every result when the search term contains
             * 'Catalyst'. Two things make that guard dead rather than
             * protective, and these tests pin both so the next reader does
             * not mistake it for load-bearing:
             *
             * The check is case sensitive and `request()` lowercases the
             * message before calling in, so it cannot fire on the only path
             * that reaches it in production. And it is redundant anyway -
             * every catalyst in the manifest is itemType 19, 20, 0 or 12, and
             * the itemType filter beside it keeps only 2, 3 and 4, so no
             * catalyst survives that far.
             *
             * Both cases below need an item the manifest does not contain (a
             * weapon-typed 'Catalyst') to reach the guard at all, which is the
             * clearest evidence it does nothing. Tracked in #741.
             */
            it('should drop a capitalised catalyst term, the only way the guard fires', async () => {
                worldRepository.getItemByName.mockResolvedValue([
                    weapon({ itemName: 'Gjallarhorn Catalyst' }),
                ]);

                await expect(twilioController.queryItem('Gjallarhorn Catalyst')).resolves.toEqual(
                    [],
                );
            });

            it('should not reach the guard through request, which lowercases first', async () => {
                worldRepository.getItemByName.mockResolvedValue([
                    weapon({ itemName: 'Gjallarhorn Catalyst' }),
                ]);

                const { message } = await twilioController.request({
                    body: inbound('Gjallarhorn Catalyst'),
                    cookies: {},
                });

                expect(message).toContain('Rocket Launcher');
            });

            it('should look up a name typed with smart quotes', async () => {
                await twilioController.queryItem('‘Hunter’s Mark’');

                expect(worldRepository.getItemByName).toHaveBeenCalledWith("'Hunter's Mark'");
            });
        });
    });

    describe('getXur', () => {
        const user = registeredUser();

        it('should send the sender to reconnect when authentication returns nothing', async () => {
            authenticationService.authenticate.mockResolvedValue(undefined);

            const { message } = await twilioController.getXur(user, {});

            expect(message).toContain('/register');
        });

        it('should answer plainly when the account has no characters', async () => {
            authenticationService.authenticate.mockResolvedValue({
                ...user,
                bungie: { access_token: accessToken },
            });
            destinyService.getProfile.mockResolvedValue([]);

            const { message } = await twilioController.getXur(user, {});

            expect(message).toContain('Ghost');
        });

        it('should list only the weapons Xur is carrying', async () => {
            authenticationService.authenticate.mockResolvedValue({
                ...user,
                bungie: { access_token: accessToken },
            });
            destinyService.getProfile.mockResolvedValue([{ characterId: 'c1' }]);
            destinyService.getXur.mockResolvedValue([1, 2]);
            worldRepository.getWeaponCategory.mockResolvedValue(5);
            worldRepository.getItemByHash
                .mockResolvedValueOnce({
                    itemCategoryHashes: [5],
                    displayProperties: { name: 'Hawkmoon' },
                })
                .mockResolvedValueOnce({
                    itemCategoryHashes: [20],
                    displayProperties: { name: 'Exotic Helmet' },
                });

            const { message, cookies } = await twilioController.getXur(user, { itemHash: '999' });

            expect(message).toContain('Hawkmoon');
            expect(message).not.toContain('Exotic Helmet');
            expect(cookies.itemHash).toBeUndefined();
        });

        it('should relay what Bungie said when Bungie refuses', async () => {
            authenticationService.authenticate.mockRejectedValue(
                new DestinyError(1627, 'Xur is not around.', 'DestinyVendorNotFound'),
            );

            const { message } = await twilioController.getXur(user, {});

            expect(message).toBe('Xur is not around.');
        });

        it('should not leak an unexpected failure to the sender', async () => {
            authenticationService.authenticate.mockRejectedValue(new Error('socket hang up'));

            const { message } = await twilioController.getXur(user, {});

            expect(message).not.toContain('socket hang up');
            expect(message.length).toBeGreaterThan(0);
        });
    });

    describe('statusCallback', () => {
        it('should ignore a callback with no recipient', async () => {
            await twilioController.statusCallback({ MessageStatus: 'delivered' });

            expect(userService.addUserMessage).not.toHaveBeenCalled();
        });

        it('should ignore a callback with no status', async () => {
            await twilioController.statusCallback({ To: phoneNumber });

            expect(userService.addUserMessage).not.toHaveBeenCalled();
        });

        it('should ignore a callback for a number it does not know', async () => {
            userService.getUserByPhoneNumber.mockResolvedValue(undefined);

            await twilioController.statusCallback({
                To: phoneNumber,
                MessageStatus: 'delivered',
            });

            expect(userService.addUserMessage).not.toHaveBeenCalled();
        });

        it('should record the delivery outcome against the message', async () => {
            await twilioController.statusCallback({
                To: phoneNumber,
                MessageStatus: 'delivered',
            });

            expect(userService.addUserMessage).toHaveBeenCalledWith(
                expect.objectContaining({ SmsStatus: 'delivered' }),
            );
        });

        /** Twilio sends MessageStatus here; SmsStatus is the legacy spelling. */
        it('should accept the legacy status field', async () => {
            await twilioController.statusCallback({ To: phoneNumber, SmsStatus: 'sent' });

            expect(userService.addUserMessage).toHaveBeenCalledWith(
                expect.objectContaining({ SmsStatus: 'sent' }),
            );
        });

        it('should update the claim check when the callback carries one', async () => {
            await twilioController.statusCallback({
                To: phoneNumber,
                MessageStatus: 'delivered',
                ClaimCheck: 'cc1',
            });

            expect(ClaimCheck.updatePhoneNumber).toHaveBeenCalledWith(
                'cc1',
                phoneNumber,
                'delivered',
            );
        });

        it('should leave the claim check alone when none is given', async () => {
            await twilioController.statusCallback({
                To: phoneNumber,
                MessageStatus: 'delivered',
            });

            expect(ClaimCheck.updatePhoneNumber).not.toHaveBeenCalled();
        });
    });

    describe('fallback', () => {
        it('should answer with something rather than nothing', () => {
            expect(TwilioController.fallback()).toEqual(expect.any(String));
            expect(TwilioController.fallback().length).toBeGreaterThan(0);
        });
    });
});
