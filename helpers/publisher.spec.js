/**
 * Publish Messages
 */
const Chance = require('chance');
const Publisher = require('./publisher');

const chance = new Chance();
const publisher = new Publisher();

describe('Message delivery test', () => {
    it('Should return true for success', done => {
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
    });
});
