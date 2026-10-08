// @ts-check
import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import {
    accept,
    keepAlive,
    reservationFor,
    release,
    reserve,
} from '../helpers/idempotency-keys.js';
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

    /**
     * How far a broadcast has got: its job's state, how many recipients it
     * has queued and found already queued for the week, and, if it has been
     * retrying, how many times and why.
     */
    notificationRouter.route('/broadcasts/:claimCheck').get(authorizeUser, async (req, res) => {
        const {
            params: { claimCheck: number },
        } = req;
        const broadcast = await notificationController.getBroadcast(number);

        if (broadcast) {
            res.status(StatusCodes.OK).json(broadcast);
        } else {
            res.status(StatusCodes.NOT_FOUND).end();
        }
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
     * concurrent requests carrying it resolve to one operation, and accepted
     * once the broadcast is durably recorded, after which it finishes
     * whether or not this process does; see
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

        const request = {
            caller: res.locals.caller,
            key: key.data,
            fingerprint: `POST /notifications/${subscription}`,
        };
        const reservation = reservationFor(request);
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
        let claimCheckNumber;

        try {
            ({ claimCheckNumber } = await notificationController.create(subscription, {
                operationId: reservation.operationId,
            }));
        } catch (err) {
            await release(reservation).catch(releaseErr =>
                log.warn(
                    { err: releaseErr, operationId: reservation.operationId },
                    'Unable to release the idempotency key; it expires with its lease.',
                ),
            );

            throw err;
        } finally {
            stopKeepAlive();
        }

        /**
         * The broadcast is recorded by now and will run regardless, so
         * nothing below may turn this into a failure: the client would retry
         * a broadcast that is already under way. A reservation that cannot be
         * accepted lapses with its lease instead. A retry after that derives
         * the same operation id from the same key, so it finds this broadcast
         * already recorded under that id rather than recording a second one,
         * and answers with this claim check.
         */
        try {
            if (!(await accept(reservation))) {
                log.warn(
                    { operationId: reservation.operationId },
                    'The idempotency key lapsed before its operation was accepted.',
                );
            }
        } catch (err) {
            log.warn(
                { err, operationId: reservation.operationId },
                'Unable to accept the idempotency key; it expires with its lease.',
            );
        }

        res.set('Destiny-Ghost-Postmaster', claimCheckNumber).status(StatusCodes.ACCEPTED).end();
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
