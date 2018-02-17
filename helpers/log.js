/**
 * A module for logging web requests and their corresponding responses.
 *
 * @module Log
 * @summary Log request and response.
 * @author Chris Paskvan
 * @description Logging provider for recording requests and responses.
 * Adopted from Eric Elliott's bunyan-request-logger project hosted at
 * {@link https://github.com/ericelliott/bunyan-request-logger} and
 * outlined in detail at {@link http://chimera.labs.oreilly.com/books/1234000000262/ch07.html#logging-requests}.
 * @requires _
 * @requires bunyan
 * @requires cuid
 */
const _ = require('underscore'),
	PrettyStream = require('bunyan-pretty-colors'),
	bunyan = require('bunyan'),
	cuid = require('cuid'),
	{ name } = require('../package.json');

let prettyStdOut = new PrettyStream();
prettyStdOut.pipe(process.stdout);

/**
 * Get long stack traces for the error logger.
 * @param  {error} err - Error object
 * @return {string} Stack trace
 */
function _getFullStack(err) {
	let stack = err.stack || err.toString();

	if (err.cause && typeof (err.cause) === 'function') {
		let cause = err.cause();

		if (cause) {
			stack += '\n' + _getFullStack(cause);
		}
	}

	return stack;
}

const serializers = {
	req: function reqSerializer(req) {
		if (!req || !req.connection) {
			return req;
		}

		return {
			url: req.url,
			method: req.method,
			protocol: req.protocol,
			requestId: req.requestId,
			/** Check for a proxy server. */
			ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
			headers: req.headers,
			body: _.omit(req.body, 'password')
		};
	},
	res: function resSerializer(res) {
		if (!res) {
			return res;
		}

		return {
			statusCode: res.statusCode,
			headers: res._header,
			body: res._json || res._end,
			requestId: res.requestId,
			responseTime: res.responseTime
		};
	},
	err: function errSerializer(err) {
		if (!err || !err.stack) {
			return err;
		}

		return {
			message: err.message,
			name: err.name,
			stack: _getFullStack(err),
			code: err.code,
			signal: err.signal,
			requestId: err.requestId
		};
	}
};

const defaults = {
	name,
	streams: [
		{
			level: 'info',
			stream: prettyStdOut
		},
		{
			level: 'error',
			stream: process.stderr
		}
	],
	serializers: _.extend(bunyan.stdSerializers, serializers)
};

class Log {
    constructor() {
        this.logger = bunyan.createLogger(defaults);
    }

    info(message, data) {
        this.logger.info({ message: data }, message);
    }

    error(err) {
        this.logger.error({ err });
    }

	requestLogger() {
		return (req, res, next) => {
			const startTime = new Date();

			/**
			 * Add a unique identifier to the request.
			 */
			req.requestId = cuid();
			this.logger.info({ req });

			/**
			 * Make sure responses get logged too.
			 */
			const logResponse = () => {
				res.responseTime = new Date() - startTime;
				res.requestId = req.requestId;
				this.logger.info({ res });

				/**
				 * Prevent the following warning:
				 * possible EventEmitter memory leak detected. 11 finish listeners added.
				 * @see {link:http://www.jongleberry.com/understanding-possible-eventemitter-leaks.html}
				 */
				res.removeListener('finish', logResponse);
				res.setMaxListeners(res.getMaxListeners() - 1);
			};

			res.setMaxListeners(res.getMaxListeners() + 1);
			res.on('finish', logResponse);

			next();
		}
	}

	errorLogger() {
		return (err, req, res, next) => {
			const status = err.status || (res && res.status);

			/**
			 * Add a requestId to track the original request.
			 */
			err.requestId = req && req.requestId;
			/**
			 * Omit stack from the 4xx range.
			 */
			if (status >= 400 && status <= 499) {
				delete err.stack;
			}

			this.logger.error({ err });

			next(err);
		};
	}
}

module.exports = new Log();
