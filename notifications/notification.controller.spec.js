'use strict';
const NotificationController = require('./notification.controller'),
    chai = require('chai'),
    chance = require('chance')(),
    { Response: { data: { characters }}} = require('../mocks/charactersResponse.json'),
    { Response: manifest } = require('../mocks/manifestResponse.json'),
    expect = require('chai').expect,
    mockUser = require('../mocks/users.json')[0],
    sinon = require('sinon'),
    sinonChai = require('sinon-chai');

chai.use(sinonChai);

let notificationController;

beforeEach(function () {
    const destinyService = {
        getCharacters: () => Promise.resolve(characters),
		getCurrentUser: () => Promise.resolve(),
		getFieldTestWeapons: () => Promise.resolve({
            vendor: '1',
            nextRefreshDate: '2017-08-17T00:57:49.000Z',
            itemHashes: [1, 2, 3]
        }),
        getManifest: () => Promise.resolve(manifest)
    };
    const notificationService = {
        sendMessage: () => Promise.resolve({
            sid: '1',
            dateCreated: '2017-08-17T00:57:49.000Z',
            status: 'queued'
        })
    };
    const userService = {
        addUserMessage: () => Promise.resolve(),
        getUserByDisplayName: () => {}
    };
    const worldRepository = {
        close: () => Promise.resolve(),
        getVendorIcon: () => Promise.resolve(chance.url()),
        open: () => Promise.resolve(),
        getItemByHash: () => Promise.resolve({
            itemName: chance.word()
        })
    };

    sinon.stub(destinyService, 'getCurrentUser').resolves({
        displayName: 'l',
        membershipType: 2,
        links: [
            {
                rel: 'characters',
                href: '/api/destiny/characters'
            }
        ]
    });
    sinon.stub(userService, 'getUserByDisplayName').resolves({
        bungie: {
            accessToken: {
                value: '11'
            }
        }
    });

    notificationController = new NotificationController({
        destinyService,
        notificationService,
        userService,
        worldRepository
    });
});

describe('NotificationController', () => {
    const req = {
        session: {}
    };
    const res = {
        end: () => {},
        json: function () {
            return this;
        },
        status: function () {
            return this;
        }
    };

    describe('getFieldTestWeapons', function () {
        let spy;

        beforeEach(() => spy = sinon.spy(res, 'status'));

        it('should return a list of field test weapons', function () {
            notificationController.getFieldTestWeapons(mockUser)
                .then(function (response) {
                    console.log(response);
                })
                .catch(function (err) {
                    console.log(err);
                });
        });

        afterEach(() => res.status.restore());
    });
});
