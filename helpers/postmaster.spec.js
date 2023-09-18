/**
 * Postmaster Model Tests
 */
import {
    describe, expect, it,
} from 'vitest';
import Postmaster from './postmaster';
import users from '../mocks/users.json';

const postmaster = new Postmaster();

describe.skip('Postmaster delivery test', () => {
    const image = 'https://www.bungie.net/common/destiny_content/icons/ea293ac821ec38fa246199ad78732f22.png';
    const url = '/register';

    it('Should return a message Id', () => new Promise(done => {
        const user = users[0];

        postmaster.register(user, image, url)
            .then(response => {
                expect(response.accepted[0]).toEqual(user.emailAddress);
                done();
            });
    }));
});
