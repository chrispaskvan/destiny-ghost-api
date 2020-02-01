/**
 * QueryBuilder Tests
 */
const QueryBuilder = require('./queryBuilder');

describe('QueryBuilder', () => {
    it('should select all fields from root where userName matches criteria', () => {
        const queryBuilder = new QueryBuilder();
        const sql = 'SELECT * FROM root r WHERE r.userName = @userName AND r.membershipType = @membershipType';

        queryBuilder.where('userName', 'userName1');
        queryBuilder.where('membershipType', 1);

        const query = queryBuilder.getQuery();

        expect(query.query).toEqual(sql);
        expect(query.parameters).toEqual([
            {
                name: '@userName',
                value: 'userName1',
            },
            {
                name: '@membershipType',
                value: 1,
            },
        ]);
    });
    it('should select id from users where userName matches criteria', () => {
        const queryBuilder = new QueryBuilder();
        const sql = 'SELECT u.id FROM users u WHERE u.userName = @userName';

        queryBuilder.select('id')
            .from('users')
            .where('userName', 'userName1');

        const query = queryBuilder.getQuery();

        expect(query.query).toEqual(sql);
        expect(query.parameters).toEqual([
            {
                name: '@userName',
                value: 'userName1',
            },
        ]);
    });
    it('should select displayName, membershipType, and phoneNumber from users where notification type is enabled and Xur', () => {
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

        const query = queryBuilder.getQuery();

        expect(query.query).toEqual(sql);
        expect(query.parameters).toEqual([
            {
                name: '@type',
                value: 'Xur',
            },
            {
                name: '@enabled',
                value: true,
            },
        ]);
    });
});
