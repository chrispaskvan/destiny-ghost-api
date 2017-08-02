/**
 * User Service Tests
 */
'use strict';
var _ = require('underscore'),
    chance = require('chance')(),
    documentService = require('./documents'),
    expect = require('chai').expect,
    sinon = require('sinon'),
    validator = require('validator');

describe('Documents', function () {
    describe('getDocuments', function () {
        it('should return 1 document', function () {
            var collectionId = 'Users';
            var options = {
                enableCrossPartitionQuery: true,
                pageSize: 1
            };
            var query = {
                query: 'SELECT * FROM u'
            };
            return documentService.getDocuments(collectionId, query, options)
                .then(function (documents) {
                    expect(documents).to.be.defined;
                    expect(documents.length).to.equal(1);
                });
        });
    });
});
