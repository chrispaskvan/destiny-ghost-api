// @ts-check
import { createId } from '@paralleldrive/cuid2';
import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { accept, keepAlive, release, reserve } from '../helpers/idempotency-keys.js';
import log from '../helpers/log.js';
import notificationTypes from './notification.types.js';
import NotificationController from './notification.controller.js';
import authorizeUser from '../authorization/authorization.middleware.js';

/**
 * @openapi
 *  components:
 *    schemas:
 *      Notification:
 *        type: object
 *        required:
 *          - enabled
 *          - type
 *        properties:
 *          enabled:
 *            type: boolean
 *          type:
 *            type: string
 *            examples: [Xur]
 */

const idempotencyKeySchema = z.string().min(1).max(255);

/**
 * Resolve a broadcast's reservation once every recipient has been queued,
 * or has failed to be.
 *
 * Accepting any earlier would let a replay return a receipt for a broadcast
 * that a crash cut short, with nothing left to finish it. Until this runs,
 * replays are told to retry, and if the process dies first the lease lapses
 * so a retry starts the broadcast again; recipients already queued are
 * absorbed by recipient deduplication.
 *
 * When some recipients could not be queued, the key is released rather than
 * accepted, so that a retry can queue them. Never rejects: by now the client
 * already has its 202.
 * @param {import('../helpers/idempotency-keys.js').Reservation} reservation
 * @param {Promise<{ failed: number }>} scheduled
 * @returns {Promise<void>}
 */
const settleReservation = async (reservation, scheduled) => {
    const { operationId } = reservation;

    try {
        const { failed } = await scheduled;

        if (failed) {
            await release(reservation);
            log.warn(
                { operationId, failed },
                'Released the idempotency key: some recipients could not be queued.',
            );

            return;
        }

        if (!(await accept(reservation))) {
            log.warn(
                { operationId },
                'The idempotency key lapsed before its operation was accepted.',
            );
        }
    } catch (err) {
        log.warn(
            { err, operationId },
            'Unable to settle the idempotency key; it expires with its lease.',
        );
    }
};

/**
 * @typedef {Object} NotificationRoutesOptions
 * @property {import('../authentication/authentication.service.js').default} authenticationService
 * @property {import('../destiny2/destiny2.service.js').default} destinyService
 * @property {import('./notification.service.js').default} notificationService
 * @property {import('../users/user.service.js').default} userService
 * @property {import('../helpers/world2.js').default} worldRepository
 */

/**
 * Notification Routes
 *
 * @param {NotificationRoutesOptions} options
 * @returns {import('express').Router}
 */
const routes = ({
    authenticationService,
    destinyService,
    notificationService,
    userService,
    worldRepository,
}) => {
    const notificationRouter = Router();

    /**
     * Set up routes and initialize the controller.
     * @type {NotificationController}
     */
    const notificationController = new NotificationController({
        authenticationService,
        destinyService,
        notificationService,
        userService,
        worldRepository,
    });

    notificationRouter.route('/claimChecks/:claimCheck').get(authorizeUser, async (req, res) => {
        const {
            params: { claimCheck: number },
        } = req;

        const claimCheck = await notificationController.getClaimCheck(number);

        if (claimCheck) {
            res.status(StatusCodes.OK).json(claimCheck);
        } else {
            res.status(StatusCodes.NOT_FOUND).end();
        }
    });

    /**
     * Broadcast a notification to every subscriber, once per
     * `Idempotency-Key`. The key is reserved before any work starts, so
     * concurrent requests carrying it resolve to one operation; see
     * `adr-files/notification-idempotency.md`.
     */
    notificationRouter.route('/:subscription').post(authorizeUser, async (req, res) => {
        const {
            params: { subscription },
        } = req;
        const key = idempotencyKeySchema.safeParse(req.headers['idempotency-key']);

        if (!key.success) {
            res.status(StatusCodes.BAD_REQUEST).end();

            return;
        }

        const reservation = {
            caller: res.locals.caller,
            key: key.data,
            fingerprint: `POST /notifications/${subscription}`,
            operationId: createId(),
        };
        const reserved = await reserve(reservation);

        if (reserved.outcome === 'mismatch') {
            res.status(StatusCodes.UNPROCESSABLE_ENTITY).send(
                'This Idempotency-Key was already used for a different request.',
            );

            return;
        }

        if (reserved.outcome === 'in-progress') {
            res.set('Retry-After', '1')
                .status(StatusCodes.CONFLICT)
                .send('A request with this Idempotency-Key is still being processed.');

            return;
        }

        if (reserved.outcome === 'replay') {
            res.set('Destiny-Ghost-Postmaster', reserved.operationId)
                .status(StatusCodes.ACCEPTED)
                .end();

            return;
        }

        const stopKeepAlive = keepAlive(reservation);
        let operation;

        try {
            operation = await notificationController.create(subscription, {
                operationId: reservation.operationId,
            });
        } catch (err) {
            stopKeepAlive();
            await release(reservation).catch(releaseErr =>
                log.warn(
                    { err: releaseErr, operationId: reservation.operationId },
                    'Unable to release the idempotency key; it expires with its lease.',
                ),
            );

            throw err;
        }

        settleReservation(reservation, operation.scheduled).finally(stopKeepAlive);

        res.set('Destiny-Ghost-Postmaster', operation.claimCheckNumber)
            .status(StatusCodes.ACCEPTED)
            .end();
    });

    notificationRouter
        .route('/:subscription/:phoneNumber')
        .post(authorizeUser, async (req, res) => {
            const {
                params: { subscription, phoneNumber },
            } = req;

            if (!Object.keys(notificationTypes).find(key => key === subscription)) {
                res.status(StatusCodes.NOT_FOUND).send('That subscription is not recognized.');

                return;
            }

            const { claimCheckNumber } = await notificationController.create(subscription, {
                phoneNumber,
            });
            const headers = {
                'Destiny-Ghost-Postmaster': claimCheckNumber,
            };

            res.set(headers).status(StatusCodes.ACCEPTED).end();
        });

    return notificationRouter;
};

export default routes;
