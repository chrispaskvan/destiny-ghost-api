var env = require('gulp-env'),
    gulp = require('gulp'),
    gulpMocha = require('gulp-mocha'),
    nodemon = require('gulp-nodemon');

gulp.task('default', function () {
    nodemon({
        script: 'app.js',
        ext: 'js',
        env: {
            PORT: 1100,
            TWILIO_ACCOUNT_SID: 'AC4f1f6a7f3cc91dcc5ac652dbe5561ab7',
            TWILIO_AUTH_TOKEN: '1c4022f7e564e7c66b352db1065a2d25'
        },
        ignore: ['./node_modules/**']
    })
        .on('restart', function () {
            console.log('Restarting ...');
        });
});

gulp.task('tests', function () {
    env({vars: {ENV: 'Test'}});
    gulp.src('tests/*.js', {read: false})
        .pipe(gulpMocha({reporter: 'nyan'}));
});