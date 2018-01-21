/**
 * Document Tests
 */
const documentService = require('./documents'),
    expect = require('chai').expect;

describe('Documents', () => {
	const collectionId = 'Users';

	describe('deleteDocumentById', () => {
		describe.skip('when document exists', () => {
			it('should delete document', () => {
				const documentId = '1';

				return documentService.deleteDocumentById(collectionId, documentId)
					.then(res => {
						expect(res).to.be.undefined;
					});
			});
		});

		describe('when document does not exist', () => {
			it('should throw an error', () => {
				const documentId = '1';

				return documentService.deleteDocumentById(collectionId, documentId)
					.catch(err => {
						expect(err).to.not.be.undefined;
					});
			});
		});
    });

    describe('getDocuments', () => {
        it('should return 1 document', () => {
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
                    expect(documents.length).to.be.above(0);
                });
        });
    });
});
