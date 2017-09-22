var gulp = require('gulp'),
    sass = require('gulp-sass'),
    autoprefixer = require('gulp-autoprefixer'),
    concat = require('gulp-concat'),
    gjslint = require('gulp-gjslint');

var STYLES = 'styles/**/*.scss';
var SCRIPTS = 'scripts/**/*.js';
var FONTS = 'fonts/**/*';

gulp.task('sass', function() {
    return gulp.src(STYLES)
        .pipe(sass())
        .pipe(concat('ardana-ui-common.css'))
        .pipe(autoprefixer({browsers: ['last 2 versions'], cascade: false}))
        .pipe(gulp.dest('dist/'));
});

gulp.task('js', function() {
    return gulp.src(SCRIPTS)
        .pipe(concat('ardana-ui-common.js'))
        .pipe(gulp.dest('dist/'));
});

gulp.task('fonts', function() {
    return gulp.src(FONTS).pipe(gulp.dest('dist/fonts/'));
});

gulp.task('dist', ['fonts', 'sass', 'js'], function() {
});

gulp.task('lint', function() {
    return gulp.src([
            'gulp/**/*.js',
            SCRIPTS
        ])
        .pipe(gjslint({flags: ['--flagfile .gjslintrc']}))
        .pipe(gjslint.reporter('console'))
        .pipe(gjslint.reporter('fail'));
});

gulp.task('watch', function() {
    gulp.watch([SCRIPTS, STYLES], ['dist']);
});

gulp.task('default', ['watch']);
