/**
 * QueryBuilder Tests
 */
const expect = require('chai').expect,
    QueryBuilder = require('./queryBuilder');

describe('QueryBuilder', () => {
    it('should select all fields from root where userName matches criteria', () => {
        let query;
        const queryBuilder = new QueryBuilder();
        const sql = 'SELECT * FROM root r WHERE r.userName = @userName AND r.membershipType = @membershipType';

        queryBuilder.where('userName', 'userName1');
        queryBuilder.where('membershipType', 1);
        query = queryBuilder.getQuery();

        expect(query.query).to.equal(sql);
        expect(query.parameters).to.deep.equal([
            {
                name: '@userName',
                value: 'userName1'
            },
            {
                name: '@membershipType',
                value: 1
            }
        ]);
    });
    it('should select id from users where userName matches criteria', () => {
        let query;
        const queryBuilder = new QueryBuilder();
        const sql = 'SELECT u.id FROM users u WHERE u.userName = @userName';

        queryBuilder.select('id')
            .from('users')
            .where('userName', 'userName1');
        query = queryBuilder.getQuery();

        expect(query.query).to.equal(sql);
        expect(query.parameters).to.deep.equal([
            {
                name: '@userName',
                value: 'userName1'
            }
        ]);
    });
    it('should select displayName, membershipType, and phoneNumber from users where notification type is enabled and Xur', () => {
        let query;
        const queryBuilder = new QueryBuilder();
        const sql = 'SELECT u.displayName, u.membershipType, u.phoneNumber FROM Users u JOIN n IN u.notifications WHERE n.type = @type AND n.enabled = @enabled';

        queryBuilder
            .select('displayName')
            .select('membershipType')
            .select('phoneNumber')
            .from('Users')
            .join('notifications')
            .where('type', 'Xur')
            .where('enabled', true);
        query = queryBuilder.getQuery();

        expect(query.query).to.equal(sql);
        expect(query.parameters).to.deep.equal([
            {
                name: '@type',
                value: 'Xur'
            },
            {
                name: '@enabled',
                value: true
            }
        ]);
    });
});
