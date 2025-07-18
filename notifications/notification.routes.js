import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { getIdempotencyKey, setIdempotencyKey } from '../helpers/idempotency-keys';
import notificationTypes from './notification.types';
import NotificationController from './notification.controller';
import authorizeUser from '../authorization/authorization.middleware';

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
 *            example: Xur
 */

/**
 * Notification Routes
 *
 * @param authenticationService
 * @param destinyService
 * @param notificationService
 * @param userService
 * @param worldRepository
 * @returns {*}
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

    notificationRouter.route('/claimChecks/:claimCheck')
        .get(authorizeUser,
            async (req, res) => {
                const { params: { claimCheck: number } } = req;

                const claimCheck = await notificationController.getClaimCheck(number);

                if (claimCheck) {
                    res.status(StatusCodes.OK).json(claimCheck);
                } else {
                    res.status(StatusCodes.NOT_FOUND).end();
                }
            });

    notificationRouter.route('/:subscription')
        .post(authorizeUser,
            async (req, res) => {
                const { params: { subscription } } = req;
                const idempotencyKey = req.headers['idempotency-key'];

                if (idempotencyKey) {
                    let claimCheck = await getIdempotencyKey(idempotencyKey);

                    if (!claimCheck) {
                        claimCheck = await notificationController
                            .create(subscription, null);
                        await setIdempotencyKey(idempotencyKey, claimCheck);
                    }

                    const headers = {
                        'Destiny-Ghost-Postmaster': claimCheck,
                    };

                    res.set(headers).status(StatusCodes.ACCEPTED).end();
                } else {
                    res.status(StatusCodes.BAD_REQUEST).end();
                }
            });

    notificationRouter.route('/:subscription/:phoneNumber')
        .post(authorizeUser,
            async (req, res) => {
                const { params: { subscription, phoneNumber } } = req;

                if (!Object.keys(notificationTypes).find(key => key === subscription)) {
                    res.status(StatusCodes.NOT_FOUND).send('That subscription is not recognized.');

                    return;
                }

                const claimCheck = await notificationController.create(subscription, phoneNumber);
                const headers = {
                    'Destiny-Ghost-Postmaster': claimCheck,
                };

                res.set(headers).status(StatusCodes.ACCEPTED).end();
            });

    return notificationRouter;
};

export default routes;
