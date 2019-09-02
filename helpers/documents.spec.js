/**
 * Document Tests
 */
const documentService = require('./documents');

describe('Documents', () => {
	const collectionId = 'Users';

	describe('deleteDocumentById', () => {
		describe.skip('when document exists', () => {
			it('should delete document', () => {
				const documentId = '1';

				return documentService.deleteDocumentById(collectionId, documentId)
					.then(res => {
						expect(res).not.toBeUndefined;
					});
			});
		});

		describe('when document does not exist', () => {
			it('should throw an error', () => {
				const documentId = '1';

				return documentService.deleteDocumentById(collectionId, documentId)
					.catch(err => {
						expect(err).not.toBeUndefined;
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

	        jest.setTimeout(20000);
            return documentService.getDocuments(collectionId, query, options)
                .then(documents => {
                    expect(documents).not.toBeUndefined;
                    expect(documents.length).toBeGreaterThan(0);
                });
        });
    });
});
