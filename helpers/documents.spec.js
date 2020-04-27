/**
 * Document Tests
 */
const QueryBuilder = require('./queryBuilder');
const documentService = require('./documents');

describe('Documents', () => {
    const collectionId = 'Messages';

    it('should create, read, update, and delete a document', async () => {
        const document = {
            DateTime: new Date().toISOString(),
            SmsSid: 'SM11',
            SmsStatus: 'queued',
            MessageStatus: 'queued',
            To: '+1234567890',
        };
        const { id: createdDocumentId } = await documentService
            .createDocument(collectionId, document);

        expect(createdDocumentId).toBeDefined();

        const qb = new QueryBuilder();

        qb.where('SmsSid', document.SmsSid);

        const [fetchedDocument] = await documentService
            .getDocuments(collectionId, qb.getQuery(), { partitionKey: document.To });

        expect(fetchedDocument).toBeDefined();
        expect(fetchedDocument.id).toEqual(createdDocumentId);
        expect(fetchedDocument.To).toEqual(document.To);

        const dateTime = new Date().toISOString();

        const updatedDocument = await documentService.updateDocument(collectionId, {
            ...document,
            DateTime: dateTime,
            SmsStatus: 'sent',
            MessageStatus: 'sent',
        }, document.To);

        expect(updatedDocument).toBeDefined();
        expect(updatedDocument.DateTime).toEqual(dateTime);

        const result = await documentService
            .deleteDocumentById(collectionId, createdDocumentId, document.To);

        expect(result).toBeDefined();
    });
});
