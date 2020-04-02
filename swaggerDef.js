module.exports = {
    openapi: '3.0.0',
    info: {
        title: 'Destiny-Ghost API',
        version: '2.2.1',
        description:
            'A Node Express application for receiving SMS/MMS Notifications around changes to the vendor wares in Bungie\'s Destiny and make ad-hoc queries in the database.',
        license: {
            name: 'MIT',
            url: 'https://choosealicense.com/licenses/mit',
        },
    },
    servers: [
        {
            url: 'http://localhost:1100',
        },
        {
            url: 'https://api2.destiny-ghost.com',
        },
        {
            url: 'https://api.destiny-ghost.com',
        },
    ],
    apis: ['../**/*.routes.js'],
    basePath: '/',
};
