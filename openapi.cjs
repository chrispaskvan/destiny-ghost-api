const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
    openapi: '3.0.0',
    info: {
        title: 'Destiny-Ghost API',
        version: '2.5.0',
        description:
            'A Node Express application for receiving SMS/MMS Notifications around changes to the vendor wares in Bungie\'s Destiny and make ad-hoc queries in the database.',
        license: {
            name: 'MIT',
            url: 'https://choosealicense.com/licenses/mit',
        },
    },
    servers: [
        isProduction
            ? { url: 'https://api.destiny-ghost.com', description: 'Production server' }
            : { url: 'https://api2.destiny-ghost.com', description: 'Development server' },
    ],
    components: {
        securitySchemes: {
            bungieOAuth: {
                type: 'oauth2',
                description: 'This API uses OAuth 2.0 with Bungie.net as the Authorization Server. Clients should obtain a Bearer token from Bungie.net and include it in the Authorization header.',
                flows: {
                    authorizationCode: {
                        authorizationUrl: 'https://www.bungie.net/en/OAuth/Authorize',
                        tokenUrl: 'https://www.bungie.net/platform/app/oauth/token/',
                        scopes: {},
                    },
                },
            },
            authorizationKey: {
                type: 'apiKey',
                in: 'header',
                name: 'Destiny-Ghost-Authorization',
                description: 'Requires administrative privileges. Specific header provided out-of-band.'
            },
        },
    },
    tags: [
        {
            name: 'Destiny',
            description: 'Destiny 1 Legacy Game',
        },
        {
            name: 'Destiny 2',
            description: 'Destiny 2 Game',
            externalDocs: {
                description: 'Bungie',
                url: 'https://www.bungie.net/destiny'
            },
        },
        {
            name: 'Health',
            description: 'Health Indicators',
        },
        {
            name: 'Users',
            description: 'User Management',
        }
    ],
};
