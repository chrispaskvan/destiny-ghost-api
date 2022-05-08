/**
 * Publish Messages
 */
const Chance = require('chance');
const Publisher = require('./publisher');

const chance = new Chance();
const serviceBusService = {
    createTopicIfNotExists: jest.fn((queueName, callback) => callback()),
    sendTopicMessage: jest.fn((queueName, message, callback) => callback(undefined, {
        isSuccessful: true,
    })),
};
const publisher = new Publisher({ serviceBusService });

describe('Message delivery test', () => {
    it('Should return true for success', () => new Promise(done => {
        const numberOfUsers = 2;
        const phoneNumber = chance.phone({
            country: 'us',
            mobile: true,
        });

        const users = [];
        for (let index = 0; index < numberOfUsers; index += 1) {
            users.push({
                firstName: chance.first(),
                emailAddress: chance.email(),
                gamerTag: 'PocketInfinity',
                lastName: chance.last(),
                phoneNumber: `+1${phoneNumber.replace(/\D/g, '')}`,
                isSubscribedToXur: true,
                membershipId: '11',
                membershipType: 2,
                notifications: [],
            });
        }

        const promises = [];
        users.forEach(user => {
            promises.push(publisher.sendNotification(user, 'Unknown'));
        });

        Promise.all(promises)
            .then(response => {
                expect(response.every(b => b === true)).toBeTruthy();
                done();
            });
    }));
});
