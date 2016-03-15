/**
 * A module for logging web requests and their corresponding responses.
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
'use strict';
var _ = require('underscore'),
    bunyan = require('bunyan'),
    cuid = require('cuid');
/**
 * @returns {{errorLogger: *, requestLogger: *}}
 * @constructor
 */
var Log = function () {
    /**
     * Get long stack traces for the error logger.
     * @param  {error} err - Error object
     * @return {string} Stack trace
     */
    var _getFullStack = function (err) {
        var ret = err.stack || err.toString(),
            cause;
        if (err.cause && typeof (err.cause) === 'function') {
            cause = err.cause();
            if (cause) {
                ret += '\n' + _getFullStack(cause);
            }
        }
        return ret;
    };
    /**
     * @type {{req: serializers.reqSerializer, res: serializers.resSerializer, err: serializers.errSerializer}}
     */
    var serializers = {
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
    /**
     * @type {{name: string, serializers: *}}
     */
    var defaults = {
        name: 'destiny-ghost-api',
        streams: [
            {
                level: 'info',
                path: './logs/destiny-ghost-api-request.log'
            },
            {
                level: 'error',
                path: './logs/destiny-ghost-api-error.log'
            }
        ],
        serializers: _.extend(bunyan.stdSerializers, serializers)
    };
    /**
     * Take bunyan options, monkey patch request and response objects for better logging,
     * and return a logger instance.
     * @param options - See bunyan documentation.
     * @private
     */
    var _createLogger = function (options) {
        var settings = _.extend(defaults, options),
            log = bunyan.createLogger(settings);
        log.requestLogger = function createRequestLogger() {
            return function requestLogger(req, res, next) {
                /**
                 * Used to calculate response times.
                 */
                var startTime = new Date();
                /**
                 * Add a unique identifier to the request.
                 */
                req.requestId = cuid();
                /**
                 * Log the request.
                 */
                log.info({ req: req });
                /**
                 * Make sure responses get logged too.
                 */
                var logResponse = function () {
                    res.responseTime = new Date() - startTime;
                    res.requestId = req.requestId;
                    log.info({ res: res });
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
            };
        };
        log.errorLogger = function createErrorLogger() {
            return function errorLogger(err, req, res, next) {
                var status = err.status || (res && res.status);
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
                log.error({ err: err });
                next(err);
            };
        };
        return log;
    };
    /**
     * @type {Function}
     */
    var logger = _createLogger(defaults);
    return {
        errorLogger: logger.errorLogger,
        requestLogger: logger.requestLogger
    };
};

module.exports = Log;
