/**
 * Document Tests
 */
const QueryBuilder = require('./queryBuilder');
const Documents = require('./documents');

jest.setTimeout(10000);

describe('Documents', () => {
    const collectionId = 'Messages';
    const document = {
        DateTime: new Date().toISOString(),
        SmsSid: 'SM11',
        SmsStatus: 'queued',
        MessageStatus: 'queued',
        To: '+1234567890',
        id: 1,
    };
    const deleteFn = jest.fn().mockResolvedValue({
        resource: document,
    });
    const fetchAllFn = jest.fn().mockResolvedValue({
        resources: [
            document,
        ],
    });
    const replaceFn = jest.fn().mockImplementation(document1 => Promise.resolve({
        resource: document1,
    }));
    const container = {
        item: jest.fn().mockReturnValue({ delete: deleteFn, replace: replaceFn }),
        items: {
            create: jest.fn().mockResolvedValue({
                resource: document,
            }),
            query: jest.fn().mockReturnValue({ fetchAll: fetchAllFn }),
        },
    };
    const containerFn = jest.fn().mockResolvedValue(container);
    const documentService = new Documents({
        client: {
            database: jest.fn().mockReturnValue({ container: containerFn }),
        },
    });

    it('should create, read, update, and delete a document', async () => {
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
