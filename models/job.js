/**
 * Created by chris on 9/28/15.
 */
var CronJob = require('cron').CronJob;
if (process.env.ENV !== 'Test') {
    console.log('production environment');
} else console.log('test environment');

var job = function () {
    var createJob = function (body, to) {
        var job = new CronJob({
            cronTime: '00 30 11 * * 1-5',
            onTick: function() {
                /*
                 * Runs every weekday (Monday through Friday)
                 * at 11:30:00 AM. It does not run on Saturday
                 * or Sunday.
                 */
            },
            start: false,
            timeZone: 'America/New_York'
        });
    };

    return {
        createJob: createJob
    }
};

module.exports = job;
