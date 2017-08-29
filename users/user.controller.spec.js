'use strict';
const UserController = require('./user.controller'),
    chai = require('chai'),
    chance = require('chance')(),
    expect = require('chai').expect,
    sinon = require('sinon'),
    sinonChai = require('sinon-chai');

chai.use(sinonChai);

let userController;

beforeEach(function () {
    const destinyService = {
        getCurrentUser: () => {}
    };
    const userService = {
        getUserByDisplayName: () => {}
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

    userController = new UserController(destinyService, userService);
});

describe('UserController', () => {
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

    describe('getCurrentUser', function () {
        let spy;

        beforeEach(() => spy = sinon.spy(res, 'status'));

        it('Should not return a user', done => {
            userController.getCurrentUser(req, res);

            expect(spy).to.have.been.calledWith(401);
            done();
        });
        it('Should return the current user', done => {
            const displayName = chance.name();

            req.session = {
                displayName: displayName,
                membershipType: 2
            };
            userController.getCurrentUser(req, res)
                .then(() => {
                    expect(spy).to.have.been.calledWith(200);
                    done();
                });
        });

        afterEach(() => res.status.restore());
    });
});
