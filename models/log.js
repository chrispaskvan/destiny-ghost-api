/**
 * Created by chris on 10/1/15.
 */
var bunyan = require('bunyan');

var log = bunyan.createLogger({
    name: 'foo'
});

log.info('hi');

var err = new Error('ack');
log.error(err, 'boom!');
