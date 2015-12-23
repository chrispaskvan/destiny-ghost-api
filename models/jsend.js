/**
 * JSend
 * @namespace
 */
'use strict';
/**
 * @type {{error: JSend.error, fail: JSend.fail, success: JSend.success}}
 */
var JSend = {
    error: function (message) {
        this.status = 'error';
        this.message = message;
        return this;
    },
    fail: function (data) {
        this.status = 'fail';
        this.data = data;
        return this;
    },
    success: function (data) {
        this.status = 'success';
        this.data = data;
        return this;
    }
};

module.exports = JSend;
