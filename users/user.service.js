const _ = require('underscore'),
	Joi = require('joi'),
	QueryBuilder = require('../helpers/queryBuilder'),
	defaults = require('json-schema-defaults'),
	notificationTypes = require('../notifications/notification.types'),
	validator = require('is-my-json-valid');

/**
 * Users Table Name
 * @type {string}
 */
const collectionId = 'Users';

/**
 * Schema for anonymous users.
 * @private
 */
const anonymousUserSchema = {
	name: 'AnonymousUser',
	type: 'object',
	properties: {
		displayName: {
			minLength: 3,
			maxLength: 16,
			required: true,
			type: 'string'
		},
		membershipId: {
			required: true,
			type: 'string'
		},
		membershipType: {
			required: true,
			type: 'integer',
			minimum: 1,
			maximum: 2
		},
		profilePicturePath: {
			required: true,
			type: 'string'
		}
	}
};

/**
 * Schema for registered users.
 * @private
 */
const userSchema = {
	name: 'User',
	type: 'object',
	properties: {
		carrier: {
			readOnly: true,
			type: 'string'
		},
		dateRegistered: {
			format: 'date-time',
			readOnly: true,
			type: 'string'
		},
		emailAddress: {
			format: 'email',
			readOnly: true,
			required: true,
			type: 'string'
		},
		firstName: {
			required: true,
			type: 'string'
		},
		displayName: {
			minLength: 3,
			maxLength: 16,
			required: true,
			type: 'string'
		},
		isSubscribed: {
			default: true,
			type: 'boolean'
		},
		membershipId: {
			required: true,
			type: 'string'
		},
		membershipType: {
			required: true,
			type: 'integer',
			minimum: 1,
			maximum: 2
		},
		lastName: {
			required: true,
			type: 'string'
		},
		messages: {
			default: [],
			required: false,
			type: 'array',
			uniqueItems: true,
			items: {
				type: 'object'
			}
		},
		notifications: {
			default: [],
			required: false,
			type: 'array',
			uniqueItems: true,
			items: {
				type: 'object'
			}
		},
		patches: {
			default: [],
			required: false,
			type: 'array',
			uniqueItems: true,
			items: {
				type: 'object'
			}
		},
		phoneNumber: {
			readOnly: true,
			required: true,
			type: 'string',
			format: 'phone'
		},
		roles: {
			default: ['User'],
			required: false,
			type: 'array',
			uniqueItems: true,
			items: {
				type: 'string'
			}
		},
		type: {
			readOnly: true,
			type: 'string'
		}
	},
	additionalProperties: true
};

/**
 * Schema for user notifications.
 * @private
 */
const notificationSchema = {
	name: 'User',
	type: 'object',
	properties: {
		enabled: {
			required: true,
			type: 'boolean'
		},
		type: {
			required: true,
			type: 'string'
		},
		messages: {
			default: [],
			required: false,
			type: 'array',
			uniqueItems: true,
			items: {
				type: 'object'
			}
		}
	},
	additionalProperties: false
};

/**
 * User Service Class
 */
class UserService {
	/**
	 * @constructor
	 */
	constructor(options = {}) {
		this.cacheService = options.cacheService;
		this.documents = options.documentService;

		this.client = options.client;
	}

	/**
	 * Add message to the user's notification history.
	 * @param displayName
	 * @param membershipType
	 * @param message
	 * @param notificationType
	 * @returns {Promise}
	 */
	async addUserMessage(displayName, membershipType, message, notificationType) {
		const user = await this.getUserByDisplayName(displayName, membershipType, true);
		let notification;
		let messages = [];

		const notificationKey = Object.keys(notificationTypes).find(key => notificationTypes[key] === notificationType);
		if (notificationKey) {
			notification = user.notifications.find(
				notification => notification.type === notificationType);
			if (!notification) {
				notification = {
					enabled: false,
					type: notificationType,
					messages
				};
				user.notifications.push(notification);
			} else if (!notification.messages) {
				notification.messages = [];
			}
			messages = notification.messages;
		} else {
			if (!user.messages) {
				user.messages = [];
			}
			messages = user.messages;
		}

		message.DateTime = new Date().toISOString();
		messages.push(message);

		return this.documents.upsertDocument(collectionId, user)
			.then(() => undefined);
	}

	/**
	 * Create an anonymous user.
	 * @param user
	 * @returns {*}
	 */
	async createAnonymousUser(user) {
		const validateUser = validator(anonymousUserSchema, {
			greedy: true
		});

		if (!validateUser(user)) {
			return Promise.reject(Error(JSON.stringify(validateUser.errors)));
		}

		const existingUser = await this.getUserByDisplayName(user.displayName, user.membershipType, true);
		if (existingUser) {
			if (existingUser.dateRegistered) {
				return Promise.reject(new Error('User is already registered.'));
			}

			return Promise.reject(new Error('Anonymous user already signed in.'));
		}

		return this.documents.createDocument(collectionId, user);
	}

	/**
	 * Create a user.
	 * @param user {Object}
	 * @returns {*}
	 */
	async createUser(user) {
		const errors = [];
		const validateNotifications = validator(notificationSchema);
		const validateUser = validator(userSchema);

		if (!validateUser(user)) {
			return Promise.reject(new Error(JSON.stringify(validateUser.errors)));
		}

		for (let notification of user.notifications) {
			if (!validateNotifications(notification)) {
				_.union(errors, validateNotifications.errors);
			}
		}

		if (errors.length) {
			return Promise.reject(new Error(JSON.stringify(errors)));
		}

		let existingUser = await this.getUserByPhoneNumber(user.phoneNumber);
		if (existingUser) {
			return Promise.reject(new Error('The phone number, ' +
				user.phoneNumber + ', is already registered.'));
		}

		existingUser = await this.getUserByEmailAddress(user.emailAddress);
		if (existingUser) {
			return Promise.reject(new Error('The email address, ' +
				user.emailAddress + ', is already registered.'));
		}

		existingUser = await this.getUserByDisplayName(user.displayName, user.membershipType, true);
		const carrier = await this.getPhoneNumberType(user.phoneNumber);
		const filter = validator.filter(userSchema);
		let filteredUser;

		user.carrier = carrier.name;
		user.type = carrier.type;
		userSchema.additionalProperties = false;
		filteredUser = filter(user);
		_.defaults(filteredUser, defaults(userSchema));
		_.extend(existingUser, filteredUser);

		return this.documents.upsertDocument(collectionId, existingUser);
	}

	/**
	 * Delete a user.
	 * @param documentId
	 * @param membershipType
	 * @returns {Promise.<T>}
	 */
	deleteUser(documentId, membershipType) {
		this.documents.deleteDocumentById(collectionId, documentId, membershipType)
		return Promise.resolve();
	}

	/**
	 * Get carrier data for a phone number.
	 * @param phoneNumber
	 * @returns {Promise}
	 */
	getPhoneNumberType(phoneNumber) {
		return new Promise((resolve, reject) => {
			this.client.phoneNumbers(phoneNumber).get({
				countryCode: 'US',
				type: 'carrier'
			}, function (err, number) {
				if (err) {
					reject(err);
				} else {
					resolve(number.carrier);
				}
			});
		});
	}

	/**
	 * Get subscribed users.
	 * @param notificationType
	 * @returns {*|Array.User}
	 */
	getSubscribedUsers(notificationType) {
		const qb = new QueryBuilder();

		if (!notificationTypes[notificationType]) {
			return Promise.reject(Error('notificationType is not valid'));
		}
		qb
			.select('displayName')
			.select('membershipType')
			.select('phoneNumber')
			.from(collectionId)
			.join('notifications')
			.where('type', notificationTypes[notificationType])
			.where('enabled', true);

		return this.documents.getDocuments(collectionId, qb.getQuery(), {
			enableCrossPartitionQuery: true
		});
	}

	/**
	 * Get user from display name (gamer tag) and membership type (console).
	 * @param displayName
	 * @param membershipType
	 * @returns {Promise}
	 */
	async getUserByDisplayName(displayName, membershipType, noCache) {
		const qb = new QueryBuilder();
		const schema = Joi.object().keys({
			displayName: Joi.string().required(),
			membershipType: Joi.number().required(),
			noCache: Joi.boolean().optional()
		});
		const { error } = Joi.validate({ displayName, membershipType, noCache }, schema,  { abortEarly: false });

		if (error) {
			const messages = error.details.map(detail => detail.message);

			return Promise.reject(messages.join(','));
		}

		qb.where('displayName', displayName);
		qb.where('membershipType', membershipType);

		const user = await this.cacheService.getUser(displayName, membershipType);
		if (!noCache && user) {
			return user;
		} else {
			const documents = await this.documents.getDocuments(collectionId, qb.getQuery())
			if (documents) {
				if (documents.length > 1) {
					throw new Error('more than 1 document found for displayName ' +
						displayName + ' and membershipType ' + membershipType);
				}

				return documents[0];
			}

			throw new Error('documents undefined');
		}
	}

	/**
	 * Get user from email address.
	 * @param emailAddress
	 * @returns {Promise}
	 */
	async getUserByEmailAddress(emailAddress) {
		const qb = new QueryBuilder();

		if (typeof emailAddress !== 'string' || _.isEmpty(emailAddress)) {
			return Promise.reject(new Error('emailAddress string is required'));
		}

		qb.where('emailAddress', emailAddress);

		const documents = await this.documents.getDocuments(collectionId, qb.getQuery(), {
			enableCrossPartitionQuery: true
		});
		if (documents) {
			if (documents.length > 1) {
				throw new Error('more than 1 document found for emailAddress ' + emailAddress);
			}

			return documents[0];
		}

		throw new Error('documents undefined');
	}

	/**
	 * Get user from their email address token.
	 * @param emailAddressToken
	 * @returns {Promise}
	 */
	async getUserByEmailAddressToken(emailAddressToken) {
		const qb = new QueryBuilder();

		if (typeof emailAddressToken !== 'string' || _.isEmpty(emailAddressToken)) {
			return Promise.reject(new Error('emailAddressToken string is required.'));
		}

		qb.where('membership.tokens.blob', emailAddressToken);

		const documents = await this.documents.getDocuments(collectionId, qb.getQuery(), {
			enableCrossPartitionQuery: true
		});
		if (documents) {
			if (documents.length > 1) {
				throw new Error('more than 1 document found for emailAddressToken ' + emailAddressToken);
			}

			return documents[0];
		}

		throw new Error('documents undefined');
	}

	/**
	 * Get user from id.
	 * @param userId
	 * @returns {Promise}
	 */
	async getUserById(userId) {
		const qb = new QueryBuilder();

		if (typeof userId !== 'string' || _.isEmpty(userId)) {
			return Promise.reject(new Error('userId string is required'));
		}

		qb.where('id', userId);

		const documents = await this.documents.getDocuments(collectionId, qb.getQuery(), {
			enableCrossPartitionQuery: true
		});
		if (documents) {
			if (documents.length > 1) {
				throw new Error('more than 1 document found for userId ' + userId);
			}

			return documents[0];
		}

		throw new Error('documents undefined');
	}

	/**
	 * Get user from membership Id.
	 * @param membershipId
	 * @returns {Promise}
	 */
	async getUserByMembershipId(membershipId) {
		const qb = new QueryBuilder();

		if (typeof membershipId !== 'string' || _.isEmpty(membershipId)) {
			return Promise.reject(new Error('membershipId string is required'));
		}

		qb.where('membershipId', membershipId);

		const documents = await this.documents.getDocuments(collectionId, qb.getQuery(), {
			enableCrossPartitionQuery: true
		});
		if (documents) {
			if (documents.length > 1) {
				throw new Error('more than 1 document found for membershipId ' + membershipId);
			}

			return documents[0];
		}

		throw new Error('documents undefined');
	}

	/**
	 * Get user from phone number.
	 * @param phoneNumber
	 * @returns {Promise}
	 */
	async getUserByPhoneNumber(phoneNumber) {
		const qb = new QueryBuilder();

		if (typeof phoneNumber !== 'string' || _.isEmpty(phoneNumber)) {
			return Promise.reject(Error('phoneNumber string is required'));
		}

		const user = await this.cacheService.getUser(phoneNumber)
		if (user) {
			return user;
		} else {
			qb.where('phoneNumber', phoneNumber);
			const documents = await this.documents.getDocuments(collectionId, qb.getQuery(), {
				enableCrossPartitionQuery: true
			});
			if (documents) {
				if (documents.length > 1) {
					throw new Error('more than 1 document found for phoneNumber ' + phoneNumber);
				}

				return documents[0];
			}

			throw new Error('documents undefined');
		}
	}

	/**
	 * Get user from phone number token.
	 * @param phoneNumberToken
	 * @returns {Promise}
	 */
	async getUserByPhoneNumberToken(phoneNumberToken) {
		const qb = new QueryBuilder();

		if (typeof phoneNumberToken !== 'number' || _.isEmpty(phoneNumberToken)) {
			return Promise.reject(Error('phoneNumberToken number is required.'));
		}

		qb.where('membership.tokens.code', phoneNumberToken);

		const documents = await this.documents.getDocuments(collectionId, qb.getQuery(), {
			enableCrossPartitionQuery: true
		});
		if (documents) {
			if (documents.length > 1) {
				throw new Error('more than 1 document found for phoneNumberToken ' + phoneNumberToken);
			}

			return documents[0];
		}

		throw new Error('documents undefined');
	}

	/**
	 * Update anonymous user.
	 * @param anonymousUser {Object}
	 * @returns {Promise}
	 */
	async updateAnonymousUser(anonymousUser) {
		const validate = validator(anonymousUserSchema);

		if (!validate(anonymousUser)) {
			return Promise.reject(new Error(JSON.stringify(validate.errors)));
		}

		const user = await this.getUserByDisplayName(anonymousUser.displayName, anonymousUser.membershipType)
		if (user) {
			return this.documents.upsertDocument(collectionId, anonymousUser)
				.then(() => undefined);
		}

		throw new Error('user not found ' + JSON.stringify(anonymousUser));
	}

	/**
	 * Update user.
	 * @param user {Object}
	 * @returns {Promise}
	 */
	async updateUser(user) {
		const validate = validator(userSchema);

		if (!validate(user)) {
			return Promise.reject(Error(JSON.stringify(validate.errors)));
		}

		const userDocument = await this.getUserByDisplayName(user.displayName, user.membershipType);
		Object.assign(userDocument, user);

		return this.documents.upsertDocument(collectionId, userDocument)
			.then(() => this.cacheService.setUser(userDocument));
	}

	/**
	 * Replace the Bungie authentication information.
	 * @param userId
	 * @param bungie
	 * @returns {Promise}
	 */
	async updateUserBungie(userId, bungie) {
		const userDocument = await this.getUserById(userId);

		if (!userDocument) {
			throw new Error('user not found with id ' + userId);
		}

		userDocument.bungie = bungie;

		return this.documents.upsertDocument(collectionId, userDocument)
			.then(() => undefined);
	}
}

module.exports = UserService;
