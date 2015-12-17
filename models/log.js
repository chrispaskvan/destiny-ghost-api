/**
 * Created by chris on 12/15/15.
 */
'use strict';
var _ = require('underscore'),
    bunyan = require('bunyan'),
    cuid = require('cuid');

var Log = function () {
    /**
     * Get long stack traces for the error logger.
     * @param  {error} err Error object
     * @return {string}    Stack trace
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
                // Check for a proxy server.
                ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
                headers: req.headers
            };
        },
        res: function resSerializer(res) {
            if (!res) {
                return res;
            }

            return {
                statusCode: res.statusCode,
                headers: res._header,
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

    var defaults = {
        name: 'destiny-ghost-api',
        serializers: _.extend(bunyan.stdSerializers, serializers)
    };

    /**
     * Take bunyan options, monkey patch request
     * and response objects for better logging,
     * and return a logger instance.
     *
     * @param  {object}  options See bunyan docs
     * @param  {boolean} options.logParams
     *         Pass true to log request parameters
     *         in a separate log.info() call.
     * @return {object}  logger  See bunyan docs
     * @return {function} logger.requestLogger
     *                    (See below)
     */
    var _createLogger = function (options) {
        var settings = _.extend(defaults, options),
            log = bunyan.createLogger(settings);

        log.requestLogger = function createRequestLogger() {
            return function requestLogger(req, res, next) {
                // Used to calculate response times.
                var startTime = new Date();
                // Add a unique identifier to the request.
                req.requestId = cuid();
                // Log the request.
                log.info({ req: req });
                // Make sure responses get logged, too:
                res.on('finish', function () {
                    res.responseTime = new Date() - startTime;
                    res.requestId = req.requestId;
                    log.info({ res: res });
                });
                next();
            };
        };

        log.errorLogger = function createErrorLogger() {
            return function errorLogger(err, req, res, next) {
                var status = err.status || (res && res.status);
                // Add a requestId to track the original request.
                err.requestId = req && req.requestId;
                // Omit stack from the 4xx range.
                if (status >= 400 && status <= 499) {
                    delete err.stack;
                }

                log.error({ err: err });
                next(err);
            };
        };

        return log;
    };
    var logger = _createLogger(defaults);
    return {
        errorLogger: logger.errorLogger,
        requestLogger: logger.requestLogger
    };
};

module.exports = Log;
