/**
 * Document Tests
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import QueryBuilder from './queryBuilder';
import Documents from './documents';

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
    const deleteFn = vi.fn().mockResolvedValue({
        resource: document,
    });
    const fetchAllFn = vi.fn().mockResolvedValue({
        resources: [
            document,
        ],
    });
    const replaceFn = vi.fn().mockImplementation(document1 => Promise.resolve({
        resource: document1,
    }));
    const container = {
        item: vi.fn().mockReturnValue({ delete: deleteFn, replace: replaceFn }),
        items: {
            create: vi.fn().mockResolvedValue({
                resource: document,
            }),
            query: vi.fn().mockReturnValue({ fetchAll: fetchAllFn }),
        },
    };
    const containerFn = vi.fn().mockResolvedValue(container);
    const documentService = new Documents({
        client: {
            database: vi.fn().mockReturnValue({ container: containerFn }),
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
