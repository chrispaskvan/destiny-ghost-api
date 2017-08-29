'use strict';
var env = require('gulp-env'),
    gulp = require('gulp'),
    gulpMocha = require('gulp-mocha'),
    istanbul = require('gulp-istanbul'),
    nodemon = require('gulp-nodemon');

// We'll use mocha in this example, but any test framework will work
var mocha = require('gulp-mocha');


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

gulp.task('pre-test', function () {
    env({
        vars: {
            APPINSIGHTS: './settings/applicationInsights.json',
            BITLY: './settings/bitly.json',
            DATABASE: './databases/ghost.db',
            DOMAIN: 'http://a02a08d8.ngrok.io',
            PORT: 1100,
            TWILIO: './settings/twilio.production.json'
        }
    });
    return gulp.src(['!node_modules', '!node_modules/**', './**/*.js'])
        // Covering files
        .pipe(istanbul())
        // Force `require` to return covered files
        .pipe(istanbul.hookRequire());
});

gulp.task('test', ['pre-test'], function () {
    env({
        vars: {
            APPINSIGHTS: './settings/applicationInsights.json',
            BITLY: './settings/bitly.json',
            DATABASE: './databases/ghost.db',
            DOMAIN: 'http://a02a08d8.ngrok.io',
            PORT: 1100,
            TWILIO: './settings/twilio.production.json'
        }
    });
    gulp.src(['!node_modules', '!node_modules/**', './**/*.spec.js'])
        .pipe(mocha({
            reporter: 'spec'
        }))
        // Creating the reports after tests ran
        .pipe(istanbul.writeReports({
            dir: './.coverage',
            reporters: [ 'lcov' ],
            reportOpts: { dir: './.coverage'}
        }))
        // Enforce a coverage of at least 90%
        .pipe(istanbul.enforceThresholds({ thresholds: { global: 90 } }));
});

gulp.task('test2', function () {
    env({
            vars: {
                APPINSIGHTS: './settings/applicationInsights.json',
                BITLY: './settings/bitly.json',
                DATABASE: './databases/ghost.db',
                DOMAIN: 'http://a02a08d8.ngrok.io',
                PORT: 1100,
                TWILIO: './settings/twilio.production.json'
            }
        });
    return gulp.src(['!node_modules', '!node_modules/**', './**/*.js'])
        .pipe(istanbul({
            includeUntested: true
        }))
        .on('finish', function () {
            gulp.src(['./helpers/*.js'])
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
