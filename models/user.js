/**
 * Created by chris on 10/30/15.
 */
var Q = require('q');

var User = function () {
    var getSubscribedUsers = function () {
        var deferred = Q.defer();
        setTimeout(function () {
            var users = [{ id: 1, firstName: "Chris", lastName: "Smith", phoneNumber: "8478143292" }];
            deferred.resolve(users);
        }, 2000);
        return deferred.promise;
    };
    return {
        getSubscribedUsers: getSubscribedUsers
    }
}

module.exports = User;
