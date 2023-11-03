import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { getIdempotencyKey, setIdempotencyKey } from '../helpers/idempotency-keys';
import notificationTypes from './notification.types';
import NotificationController from './notification.controller';
import authorizeUser from '../authorization/authorization.middleware';

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
        .get((req, res, next) => authorizeUser(req, res, next), (req, res, next) => {
            const { params: { claimCheck: number } } = req;

            notificationController.getClaimCheck(number)
                .then(claimCheck => {
                    if (claimCheck) {
                        res.status(StatusCodes.OK).json(claimCheck);
                    } else {
                        res.status(StatusCodes.NOT_FOUND).end();
                    }
                })
                .catch(next);
        });

    notificationRouter.route('/:subscription')
        .post((req, res, next) => authorizeUser(req, res, next), async (req, res, next) => {
            try {
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
            } catch (err) {
                next(err);
            }
        });

    notificationRouter.route('/:subscription/:phoneNumber')
        .post((req, res, next) => authorizeUser(req, res, next), (req, res, next) => {
            const { params: { subscription, phoneNumber } } = req;

            if (!Object.keys(notificationTypes).find(key => key === subscription)) {
                res.status(StatusCodes.NOT_FOUND).json('That subscription is not recognized.');

                return;
            }

            notificationController.create(subscription, phoneNumber)
                .then(claimCheck => {
                    const headers = {
                        'Destiny-Ghost-Postmaster': claimCheck,
                    };

                    res.set(headers).status(StatusCodes.ACCEPTED).end();
                })
                .catch(next);
        });

    return notificationRouter;
};

export default routes;
