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
            DOMAIN: 'http://50e9402d.ngrok.io',
            PORT: 1100,
            TWILIO: './settings/twilio.json'
        },
        ignore: ['./node_modules/**']
    }).on('restart', function () {
        console.log('Restarting ...');
    });
});

gulp.task('integrationTests', function () {
    env({ vars: {
        APPINSIGHTS: './settings/applicationInsights.json',
        BITLY: './settings/bitly.json',
        DATABASE: './databases/ghost.db',
        DOMAIN: 'http://50e9402d.ngrok.io',
        PORT: 1100,
        TWILIO: './settings/twilio.json'
    }});
    gulp.src('tests/*IntegrationTests.js', { read: false })
        .pipe(gulpMocha({ reporter: 'nyan' }));
});

gulp.task('controllerTests', function () {
    env({ vars: {
        APPINSIGHTS: './settings/applicationInsights.json',
        BITLY: './settings/bitly.json',
        DATABASE: './databases/ghost.db',
        DOMAIN: 'http://50e9402d.ngrok.io',
        PORT: 1100,
        TWILIO: './settings/twilio.json'
    }});
    gulp.src('tests/*ControllerTests.js', { read: false })
        .pipe(gulpMocha({ reporter: 'nyan' }));
});

gulp.task('modelTests', function () {
    env({ vars: {
        APPINSIGHTS: './settings/applicationInsights.json',
        BITLY: './settings/bitly.json',
        DATABASE: './databases/ghost.db',
        DOMAIN: 'http://50e9402d.ngrok.io',
        PORT: 1100,
        TWILIO: './settings/twilio.json'
    }});
    gulp.src('tests/*ModelTests.js', { read: false })
        .pipe(gulpMocha({ reporter: 'nyan' }));
});
