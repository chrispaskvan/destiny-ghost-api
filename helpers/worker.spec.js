import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import worker from './worker';

vi.mock('better-sqlite3');

describe('worker', () => {
    const databasePath = 'test.db';
    const queries = ['SELECT * FROM test'];

    let mockDatabase;
    let mockPrepare;
    let mockAll;

    beforeEach(() => {
        mockAll = vi.fn().mockReturnValue([{ id: 1, name: 'test' }]);
        mockPrepare = vi.fn().mockReturnValue({ all: mockAll });
        mockDatabase = {
            prepare: mockPrepare,
            close: vi.fn(),
        };
        Database.mockImplementation(() => mockDatabase);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should execute queries and return results', async () => {
        const results = await worker({ databasePath, queries });

        expect(Database).toHaveBeenCalledWith(databasePath, {
            readonly: true,
            fileMustExist: true,
        });
        expect(mockPrepare).toHaveBeenCalledWith(queries[0]);
        expect(mockAll).toHaveBeenCalled();
        expect(mockDatabase.close).toHaveBeenCalled();
        expect(results).toEqual([[{ id: 1, name: 'test' }]]);
    });

    it('should throw an error if database loading fails', async () => {
        Database.mockImplementation(() => {
            throw new Error('Database error');
        });

        await expect(worker({ databasePath, queries })).rejects.toThrow('Failed to load the database: Database error');
    });

    it('should close the database in the finally block', async () => {
        mockPrepare.mockImplementation(() => {
            throw new Error('Query error');
        });

        await expect(worker({ databasePath, queries })).rejects.toThrow('Failed to load the database: Query error');

        expect(mockDatabase.close).toHaveBeenCalled();
    });
});
