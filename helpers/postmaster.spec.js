/**
 * Postmaster Model Tests
 */
const Postmaster = require('../helpers/postmaster'),
    users = require('../mocks/users.json');

const postmaster = new Postmaster();

describe('Postmaster delivery test', () => {
    const image = 'https://www.bungie.net/common/destiny_content/icons/31a1c9d954b69c41733b2fda109aa27c.png';
    const url = '/register';

    it('Should return a message Id', function (done) {
        const user = users[0];

        postmaster.register(user, image, url)
            .then(response => {
                expect(response.accepted[0]).toEqual(user.emailAddress);
                done();
            });
    });
});
