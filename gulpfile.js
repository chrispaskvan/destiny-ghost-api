'use strict';
var env = require('gulp-env'),
    gulp = require('gulp'),
    gulpMocha = require('gulp-mocha'),
    nodemon = require('gulp-nodemon');

gulp.task('default', function () {
    nodemon({
        script: 'app.js',
        ext: 'js',
        env: {
            APPINSIGHTS: './settings/applicationInsights.json',
            BITLY: './settings/bitly.json',
            DATABASE: './databases/ghost.db',
            DOMAIN: 'http://38adec2c.ngrok.io',
            PORT: 1100,
            TWILIO: './settings/twilio.json'
        },
        ignore: ['./node_modules/**']
    }).on('restart', function () {
        console.log('Restarting ...');
    });
});

gulp.task('tests', function () {
    env({ vars: {
        APPINSIGHTS: './settings/applicationInsights.json',
        BITLY: './settings/bitly.json',
        DATABASE: './databases/ghost.db',
        DOMAIN: 'http://38adec2c.ngrok.io',
        PORT: 1100,
        TWILIO: './settings/twilio.json'
    }});
    gulp.src('tests/worldModelTests.js', { read: false })
        .pipe(gulpMocha({ reporter: 'nyan' }));
});
