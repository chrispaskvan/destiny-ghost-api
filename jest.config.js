module.exports = {
    coverageDirectory: '<rootDir>/.coverage',
    coveragePathIgnorePatterns: [
        '/node_modules/', '/settings/', '/databases/', '/.coverage/',
    ],
    moduleFileExtensions: ['js', 'json'],
    moduleNameMapper: {
        '^~/(.*)$': '<rootDir>/$1',
    },
    rootDir: './',
    testEnvironment: 'node',
    testMatch: [
        '<rootDir>/**/*.(spec|test).js',
    ],
    verbose: false,
};
