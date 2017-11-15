const env = require('gulp-env'),
	eslint = require('gulp-eslint'),
    gulp = require('gulp'),
    mocha = require('gulp-mocha'),
    nodemon = require('gulp-nodemon');

gulp.task('default', function runDefault() {
    nodemon({
        script: 'app.js',
        ext: 'js',
        env: {
            DATABASE: './databases/',
            DOMAIN: 'http://a02a08d8.ngrok.io',
            PORT: 1100
        },
        ignore: ['./node_modules/**']
    }).on('restart', function restart() {
        // eslint-disable-next-line no-console
        console.log('Restarting ...');
    });
});

gulp.task('lint', () => {
	return gulp.src(['**/*.js','!node_modules/**'])
		.pipe(eslint())
		.pipe(eslint.format())
		.pipe(eslint.failAfterError());
});

gulp.task('test', () => {
	env({ vars: {
		DATABASE: './databases/',
		DOMAIN: 'http://a02a08d8.ngrok.io',
		PORT: 1100
	}});

	return gulp.src(['./**/*.spec.js','!node_modules/**'], { read: false })
		.pipe(mocha({ reporter: 'nyan' }));
});
