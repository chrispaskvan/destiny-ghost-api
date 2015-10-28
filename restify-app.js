/**
 * Created by chris on 10/4/15.
 */
var restify = require('restify');
var port = process.env.PORT || 1100;

function respond(req, res, next) {
    res.send('hello ' + req.params.name);
    next();
}

var server = restify.createServer();
var destiny = require('./models/Destiny')();
var destinyController = require('./controllers/destinyController')(destiny);
server.get('/destiny/fieldTestWeapons', destinyController.getFieldTestWeapons);
server.head('/destiny/fieldTestWeapons', destinyController.getFieldTestWeapons);

server.get('/hello/:name', respond);
server.head('/hello/:name', respond);

server.listen(port, function() {
    console.log('%s listening at %s', server.name, server.url);
});

module.exports = server;
