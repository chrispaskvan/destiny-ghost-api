/**
 * Token Tests
 */
'use strict';
var expect = require('chai').expect,
    QueryBuilder = require('./queryBuilder');

describe('QueryBuilder', function () {
    it('should select all fields from root where userName matches criteria', function () {
        var query;
        var queryBuilder = new QueryBuilder();
        var sql = 'SELECT * FROM root r WHERE r.userName = @userName AND r.membershipType = @membershipType';

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
    it('should select id from users where userName matches criteria', function () {
        var query;
        var queryBuilder = new QueryBuilder();
        var sql = 'SELECT id FROM users u WHERE u.userName = @userName';

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
});
