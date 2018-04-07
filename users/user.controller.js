/**
 * A module for managing users.
 *
 * @module User Controller
 * @author Chris Paskvan
 */
const _ = require('underscore'),
    Ghost = require('../helpers/ghost'),
	Postmaster = require('../helpers/postmaster'),
	World2 = require('../helpers/world2'),
	jsonpatch = require('rfc6902'),
	log = require('../helpers/log'),
    tokens = require('../helpers/tokens');

/**
 * @constant
 * @type {string}
 * @description Postmaster Vendor Number
 */
const postmasterHash = '2021251983';

/**
 * Time To Live for Tokens
 * @type {number}
 */
const ttl = 300;

/**
 * User Controller Class
 */
class UserController {
	constructor(options = {}) {
		this.destiny = options.destinyService;
		this.ghost = new Ghost({
			destinyService: options.destinyService
		});
		this.notifications = options.notificationService;
		this.postmaster = new Postmaster();
		this.users = options.userService;
	}

	/**
	 * Apply JSON patches successively in reverse order.
	 * @param patches {Array}
	 * @param user {Object}
	 * @private
	 */
	static _applyPatches(patches, user) {
		patches.forEach(patch => {
			jsonpatch.applyPatch(user, patch.patch);
		});

		return user;
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
    static _getUserResponse({ dateRegistered, displayName, emailAddress, firstName, lastName, membershipType, notifications = [], phoneNumber, profilePicturePath }) {
		const subscriptions = notifications.map(notification => {
			const { enabled, type } = notification;

			return {
				enabled,
				type
			};
		});

        return {
			dateRegistered,
			displayName,
			emailAddress,
			firstName,
			lastName,
			membershipType,
			notifications: subscriptions,
			phoneNumber,
			links: [
				{
					rel: 'characters',
					href: '/destiny/characters'
				}
			],
			profilePicturePath
		};
	}

	/**
	 * Allow only replace operations of mutable fields.
	 * @param patches
	 * @private
	 */
	static _scrubOperations(patches) {
		const mutable = new Set(['firstName', 'lastName']);
		const replacements = patches.filter(patch => {
			return patch.op === 'replace';
		});

		return replacements.filter(replacement => {
			const properties = new Set(replacement.path.split('/'));
			const intersection = new Set([...properties].filter(x => mutable.has(x)));

			return intersection.size;
		});
	}

	/**
	 * Sign the user in by setting the session.
	 * @param req
	 * @param res
	 * @param user
	 * @private
	 */
	static _signIn(req, res, user) {
		req.session.displayName = user.displayName;
		req.session.membershipType = user.membershipType;
		req.session.state = undefined;

		return res.status(200)
			.json({displayName: user.displayName});
	}

	/**
	 * Confirm registration request by creating an account if appropriate.
	 * @param req
	 * @param res
	 */
	join(req, res) {
		const { body: user } = req;

		this.users.getUserByEmailAddressToken(user.tokens.emailAddress)
			.then(registeredUser => {
				if (!registeredUser ||
					this.constructor._getEpoch() > (registeredUser.membership.tokens.timeStamp + ttl) ||
					!_.isEqual(user.tokens.phoneNumber, registeredUser.membership.tokens.code)) {
					return res.status(498).end();
				}

				registeredUser.dateRegistered = new Date().toISOString();

				return this.users.updateUser(registeredUser)
					.then(() => res.status(200).end());
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
	async getCurrentUser(req, res) {
		const { session: { displayName, membershipType }} = req;

		if (!displayName || !membershipType) {
			return res.status(401).end();
		}

		try {
			const user = await this.users.getUserByDisplayName(displayName, membershipType);
			if (user) {
				const { bungie: { access_token: accessToken }} = user;

				const bungieUser = await this.destiny.getCurrentUser(accessToken);
				if (bungieUser) {
					return res.status(200)
						.json(this.constructor._getUserResponse(user));
				}

				return res.status(401).end();
			}

			return res.status(401).end();
		} catch (err) {
			log.error(err);
			res.status(500).json(err);
		}
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
			.then(user => {
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
	getUserById(req, res) {
		const { params: { id, version: _version }} = req;

		if (!id) {
			return res.status(409).send('phone number not found');
		}

		let version = parseInt(_version, 10);
		if (isNaN(version)) {
			version = 0;
		}

		this.users.getUserById(id)
			.then(user => {
				if (user) {
					if (version) {
						const patches = _.filter(user.patches, patch => patch.version >= version) || [];

						if (patches.length > 0) {
							return res.status(200).json(this.constructor._applyPatches(_.chain(patches)
								.sortBy(patch => -1 * patch.version)
								.value(), user));
						}

						return res.status(404).end();
					}

					return res.status(200).json(user);
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
			.then(user => {
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
	 * User initial application request.
	 * @param req
	 * @param res
	 */
	async signUp(req, res) {
		const { body: user, session: { displayName, membershipType }} = req;

		if (!(user.firstName && user.lastName && user.phoneNumber && user.emailAddress)) {
			return res.status(422).end();
		}

		let bungieUser = await this.users.getUserByDisplayName(displayName, membershipType);
		user.phoneNumber = this.constructor._cleanPhoneNumber(user.phoneNumber);
		Object.assign(user, bungieUser, {
			membership: {
				tokens: {
					blob: tokens.getBlob(),
					code: tokens.getCode(),
					timeStamp: this.constructor._getEpoch()
				}
			}
		});

		const promises = [
			this.users.getUserByEmailAddress(user.emailAddress),
			this.users.getUserByPhoneNumber(user.phoneNumber)
		];
		const world = new World2();

		return Promise.all(promises)
			.then(users => {
				const registeredUsers = users.filter(user => user && user.dateRegistered);

				if (registeredUsers.length) {
					return res.status(409).end();
				}

				return this.ghost.getWorldDatabasePath()
					.then(worldDatabasePath => world.open(worldDatabasePath))
                    .then(() => world.getVendorIcon(postmasterHash))
                    .then(iconUrl => {
						let promises = [];

						promises.push(this.notifications.sendMessage('Enter ' +
							user.membership.tokens.code + ' to verify your phone number.',
							user.phoneNumber, user.type === 'mobile' ? iconUrl : ''));
						promises.push(this.postmaster.register(user, iconUrl, '/register'));

						return Promise.all(promises);
					})
					.then(result => {
						const [message, postMark] = result;

						user.membership.message = message;
						user.membership.postmark = postMark;

						return this.users.updateUser(user);
                    })
                    .then(() => res.status(200).end())
                    .then(() => world.close());
			})
			.catch(err => {
				log.error(err);
				world.close();
				res.status(500).json(err);
			});
	}

	/**
	 * Sign In with Bungie and PSN/XBox Live
	 * @param req
	 * @param res
	 */
	async signIn(req, res) {
		const {
			query: { code, state: queryState },
			session: { displayName, state: sessionState }
		} = req;

		if (displayName) {
			return res.status(200)
				.json({ displayName });
		}
		if (sessionState !== queryState) {
			return res.sendStatus(403);
		}

		try {
			const bungieUser = await this.destiny.getAccessTokenFromCode(code);
			const { access_token: accessToken } = bungieUser;
			let user = { bungie: bungieUser };

			const currentUser = await this.destiny.getCurrentUser(accessToken);
			if (!currentUser) {
				return res.status(451).end(); // ToDo: Document
			}
			if (!currentUser.membershipId) {
				return res.status(404).end();
			}

			const { displayName, membershipId, membershipType, profilePicturePath } = currentUser;
			Object.assign(user, { displayName, membershipId, membershipType, profilePicturePath });

			const destinyGhostUser = await this.users.getUserByMembershipId(user.membershipId);
			if (!destinyGhostUser) {
				return this.users.createAnonymousUser(user)
					.then(() => this.constructor._signIn(req, res, user));
			}

			Object.assign(destinyGhostUser,  user);

			return (destinyGhostUser.dateRegistered ? this.users.updateUser(destinyGhostUser) : this.users.updateAnonymousUser(destinyGhostUser))
				.then(() => this.constructor._signIn(req, res, user));
		} catch (err) {
			log.error(err);
			return res.status(401).json(err);
		}
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
	 * {@tutorial http://williamdurand.fr/2014/02/14/please-do-not-patch-like-an-idiot}
	 * @param req
	 * @param res
	 * @returns {*}
	 */
	update(req, res) {
		const { body: patches, session: { displayName, membershipType }} = req;

		this.users.getUserByDisplayName(displayName, membershipType, true)
			.then(user => {
				if (!user) {
					return res.status(404).send('user not found');
				}

				const _user = JSON.parse(JSON.stringify(user));
				jsonpatch.applyPatch(user, this.constructor._scrubOperations(patches));

				const patch = jsonpatch.createPatch(user, _user);
				const version = user.version || 1;
				user.version = version + 1;

				if (!user.patches) {
					user.patches = [];
				}
				user.patches.push({
					patch,
					version
				});

				return this.users.updateUser(user)
					.then(() => {
						res.json(user)
					});
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}
}

module.exports = UserController;
