module.exports = {
    coverageDirectory: '<rootDir>/.coverage',
    coveragePathIgnorePatterns: [
        '/node_modules/', '/settings/', '/databases/', '/.coverage/',
    ],
    coverageReporters: ['clover', 'html'],
    coverageThreshold: {
        global: {
            branches: 58.76,
            functions: 61.25,
            lines: 71.12,
            statements: 71.21,
        },
    },
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
