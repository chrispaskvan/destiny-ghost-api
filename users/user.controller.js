/**
 * A module for managing users.
 *
 * @module User Controller
 * @author Chris Paskvan
 */
const _ = require('underscore'),
    Ghost = require('../ghost/ghost'),
	Postmaster = require('../helpers/postmaster'),
	jsonpatch = require('fast-json-patch'),
	log = require('../helpers/log'),
    tokens = require('../helpers/tokens');

/**
 * @constant
 * @type {string}
 * @description Postmaster Vendor Number
 */
const postmasterHash = '2021251983';

/**
 * Time to Live for Tokens
 * @type {number}
 */
const ttl = 300;

/**
 * User Controller Class
 */
class UserController {
	constructor(options) {
		this.destiny = options.destinyService;
		this.ghost = new Ghost({
			destinyService: options.destinyService
		});
		this.notifications = options.notificationService;
		this.postmaster = new Postmaster();
		this.users = options.userService;
		this.world = options.worldRepository;
	}

	/**
	 * Get the phone number format into the Twilio standard.
	 * @param phoneNumber
	 * @returns {string}
	 * @private
	 */
	static _cleanPhoneNumber(phoneNumber) {
		const cleaned = phoneNumber.replace(/\D/g, '');
		return '+1' + cleaned;
	}

	/**
	 * Get current epoch.
	 * @returns {number}
	 * @private
	 */
	static _getEpoch() {
		return Math.floor((new Date()).getTime() / 1000);
	}

	/**
	 * Hypermedia as the Engine of Application State (HATEOAS)
	 * @param displayName
	 * @param membershipType
	 * @param profilePicturePath
	 * @returns {{displayName: *, membershipType: *, links: [null], profilePicturePath: *}}
	 * @private
	 */
    static _getUserResponse({ displayName, membershipType, profilePicturePath }) {
		return {
			displayName,
			membershipType,
			links: [
				{
					rel: 'characters',
					href: '/api/destiny/characters'
				}
			],
			profilePicturePath
		};
	}

	/**
	 * Confirm registration request by creating an account if appropriate.
	 * @param req
	 * @param res
	 */
	join(req, res) {
		const { body: { user }} = req;

		this.users.getUserByEmailAddressToken(user.tokens.emailAddress)
			.then(registeredUser => {
				if (!registeredUser ||
					this.constructor._getEpoch() > (registeredUser.membership.tokens.timeStamp + ttl) ||
					!_.isEqual(user.tokens.phoneNumber, registeredUser.membership.tokens.code)) {
					return res.status(498).end();
				}

				registeredUser.dateRegistered = new Date().toISOString();

				return this.users.updateUser(registeredUser)
					.then(function () {
						req.session.displayName = registeredUser.displayName;
						req.session.membershipType = registeredUser.membershipType;
						res.status(200).end();
					});
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * Get current user.
	 * @param req
	 * @param res
	 */
	getCurrentUser(req, res) {
		const { session: { displayName, membershipType }} = req;

		if (!displayName || !membershipType) {
			return res.status(401).end();
		}

        this.users.getUserByDisplayName(displayName, membershipType)
			.then(user => {
				if (user) {
					return this.destiny.getCurrentUser(user.bungie.accessToken.value)
						.then(user => {
							if (user) {
								return res.status(200)
									.json(this.constructor._getUserResponse(user));
							}

							return res.status(401).end();
						});
				}

				return res.status(401).end();
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * Check if the email address is registered to a current user.
	 * @param req
	 * @param res
	 */
	getUserByEmailAddress(req, res) {
		const { params: { emailAddress }} = req;

		if (!emailAddress) {
			return res.status(409).send('email address not found');
		}

		this.users.getUserByEmailAddress(emailAddress)
			.then(function (user) {
				if (user) {
					return res.status(204).end();
				}

				return res.status(404).end();
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * Check if the phone number is registered to a current user.
	 * @param req
	 * @param res
	 */
	getUserByPhoneNumber(req, res) {
		const { params: { phoneNumber }} = req;

		if (!phoneNumber) {
			return res.status(409).send('phone number not found');
		}

		this.users.getUserByPhoneNumber(phoneNumber)
			.then(function (user) {
				if (user) {
					return res.status(204).end();
				}
				return res.status(404).end();
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * User initial registration request.
	 * @param req
	 * @param res
	 */
	apply(req, res) {
		let promises = [];

		this.users.getUserByDisplayName(req.session.displayName, req.session.membershipType)
			.then(user => {
				if (!user) {
					return res.status(401).end();
				}

				_.extend(user, _.extend(req.body, {
					membership: {
						tokens: {
							blob: tokens.getBlob(),
							code: tokens.getCode(),
							timeStamp: this.constructor._getEpoch()
						}
					}
				}));
				user.phoneNumber = this.constructor._cleanPhoneNumber(user.phoneNumber);

				promises.push(this.users.getUserByEmailAddress(user.emailAddress));
				promises.push(this.users.getUserByPhoneNumber(user.phoneNumber));

				return Promise.all(promises)
					.then(users => {
						if (users.find(user => user && user.dateRegistered).length) {
							return res.status(409).end();
						}

						this.ghost.getWorldDatabasePath()
							.then(worldDatabasePath => this.world.open(worldDatabasePath))
                            .then(() => this.world.getVendorIcon(postmasterHash))
                            .then(iconUrl => {
                                return this.notifications.sendMessage('Enter ' +
                                        user.membership.tokens.code + ' to verify your phone number.',
                                        user.phoneNumber, user.type === 'mobile' ? iconUrl : '')
                                    .then(message => [message, this.postmaster.register(user, iconUrl, '/register')])
                                    .spread((message, postmark) => {
                                        user.membership.message = message;
                                        user.membership.postmark = postmark;

                                        return this.users.updateUser(user);
                                    })
                                    .then(() => res.status(200).end());
                            })
                            .then(() => this.world.close());
					});
			})
			.catch(function (err) {
				log.error(err);
				this.world.close();
				res.status(500).json(err);
			});
	}

	/**
	 * Sign In with Bungie and PSN/XBox Live
	 * @param req
	 * @param res
	 */
	signIn(req, res) {
		const {
			query: { code, state: queryState },
			session: { displayName, state: sessionState }
		} = req;

		if (displayName) {
			return res.status(200)
				.json({ displayName: req.session.displayName });
		}
		if (sessionState !== queryState) {
			return res.sendStatus(403);
		}

		this.destiny.getAccessTokenFromCode(code)
			.then(bungieUser => {
				const { accessToken: { value }} = bungieUser;

				return this.destiny.getCurrentUser(value)
					.then(user => {
						if (!user) {
							return res.status(451).end(); // ToDo: Document
						}
						if (!user.membershipId) {
							return res.status(404).end();
						}
						_.extend(user, {
							bungie: bungieUser
						});
						this.users.createAnonymousUser(user)
							.then(function () {
								req.session.displayName = user.displayName;
								req.session.membershipType = user.membershipType;
								req.session.state = undefined;

								return res.status(200)
									.json({ displayName: user.displayName });
							});
					});
			})
			.catch(function (err) {
				log.error(err);
				return res.status(401).send(err.message);
			});
	}

	/**
	 * Sign In with Bungie and PSN/XBox Live
	 * @param req
	 * @param res
	 */
	signOut(req, res) {
		req.session.destroy();
		res.status(401).end();
	}

	/**
	 * Uses JSON patch as described {@link https://github.com/Starcounter-Jack/JSON-Patch here}.
	 * @param req
	 * @param res
	 * @returns {*}
	 * @todo Deny operations on immutable properties.
	 */
	update(req, res) {
		const { body: patches, params: { membershipId }} = req;

		if (!membershipId) {
			return res.status(409).send('membershipId not found');
		}

		this.users.getUserByMembershipId(membershipId)
			.then(user => {
				if (!user) {
					return res.status(404).send('user not found');
				}

				jsonpatch.apply(user, patches);

				return this.users.updateUser(user)
					.then(function () {
						res.json(user);
					});
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}
}

module.exports = UserController;
