const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const isProduction = process.env.NODE_ENV === 'production';
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

module.exports = {
    openapi: '3.1.1',
    info: {
        title: 'Destiny-Ghost API',
        version: packageJson.version,
        description:
            "A Node Express application for receiving SMS/MMS Notifications around changes to the vendor wares in Bungie's Destiny and make ad-hoc queries in the database.",
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
                description:
                    'This API authenticates via Bungie.net OAuth 2.0, but clients never handle a bearer token directly. GET /destiny/signIn/ returns the Bungie authorization URL; after the user approves access, Bungie redirects to GET /users/signIn/Bungie, which exchanges the code server-side and establishes an httpOnly session cookie. All bungieOAuth-secured endpoints are authenticated via that session cookie, not an Authorization header.',
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
                description:
                    'Requires administrative privileges. Specific header provided out-of-band.',
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
                url: 'https://www.bungie.net/destiny',
            },
        },
        {
            name: 'Health',
            description: 'Health Indicators',
        },
        {
            name: 'Users',
            description: 'User Management',
        },
    ],
};
