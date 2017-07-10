'use strict';
var env = require('gulp-env'),
    gulp = require('gulp'),
    gulpMocha = require('gulp-mocha'),
    istanbul = require('gulp-istanbul'),
    nodemon = require('gulp-nodemon');

gulp.task('default', function runDefault() {
    nodemon({
        script: 'app.js',
        ext: 'js',
        env: {
            APPINSIGHTS: './settings/applicationInsights.json',
            BITLY: './settings/bitly.json',
            DATABASE: './databases/ghost.db',
            DOMAIN: 'http://a02a08d8.ngrok.io',
            PORT: 1100,
            TWILIO: './settings/twilio.production.json'
        },
        ignore: ['./node_modules/**']
    }).on('restart', function restart() {
        console.log('Restarting ...');
    });
});

gulp.task('integrationTests', function runIntegrationTests() {
    env({ vars: {
        APPINSIGHTS: './settings/applicationInsights.json',
        BITLY: './settings/bitly.json',
        DATABASE: './databases/ghost.db',
        DOMAIN: 'http://a02a08d8.ngrok.io',
        PORT: 1100,
        TWILIO: './settings/twilio.production.json'
    }});
    gulp.src('tests/*IntegrationTests.js', { read: false })
        .pipe(gulpMocha({ reporter: 'nyan' }));
});

gulp.task('controllerTests', function runControllerTests() {
    env({ vars: {
        APPINSIGHTS: './settings/applicationInsights.json',
        BITLY: './settings/bitly.json',
        DATABASE: './databases/ghost.db',
        DOMAIN: 'http://713842b6.ngrok.io',
        PORT: 1100,
        TWILIO: './settings/twilio.production.json'
    }});
    gulp.src('tests/authenticationControllerTests.js', { read: false })
        .pipe(gulpMocha({ reporter: 'nyan' }));
});

gulp.task('modelTests', function runModelTests() {
    env({ vars: {
        APPINSIGHTS: './settings/applicationInsights.json',
        BITLY: './settings/bitly.json',
        DATABASE: './databases/ghost.db',
        DOMAIN: 'http://a02a08d8.ngrok.io',
        PORT: 1100,
        TWILIO: './settings/twilio.production.json'
    }});
    gulp.src('tests/*ModelTests.js', { read: false })
        .pipe(gulpMocha({ reporter: 'nyan' }));
});

gulp.task('test', function () {
    return gulp.src('tests/tokenModelTests.js')
        .pipe(istanbul({
            includeUntested: true
        }))
        .on('finish', function () {
            gulp.src('tests/tokenModelTests.js')
                .pipe(gulpMocha({
                    reporter: 'spec'
                }))
                .pipe(istanbul.writeReports({
                    dir: './.coverage',
                    reporters: [ 'lcov' ],
                    reportOpts: { dir: './.coverage'}
                }));
        });
});
