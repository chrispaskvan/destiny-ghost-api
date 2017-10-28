/**
 * Document Tests
 */
'use strict';
const documentService = require('./documents'),
    expect = require('chai').expect;

describe('Documents', () => {
    describe('getDocuments', () => {
        it('should return 1 document', () => {
            const collectionId = 'Users';
            const options = {
                enableCrossPartitionQuery: true,
                pageSize: 1
            };
            const query = {
                query: 'SELECT * FROM u'
            };

            return documentService.getDocuments(collectionId, query, options)
                .then(documents => {
                    expect(documents).to.not.be.undefined;
                    expect(documents.length).to.equal(1);
                });
        });
    });
});
