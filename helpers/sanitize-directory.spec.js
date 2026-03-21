import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import sanitizeDirectory from './sanitize-directory.js';

vi.mock('node:fs', () => ({
    realpathSync: vi.fn(),
}));

describe('sanitizeDirectory', () => {
    const rootDirectory = '/app/project';

    beforeEach(() => {
        process.env.INIT_CWD = rootDirectory;
        realpathSync.mockImplementation(p => p);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should fall back to process.cwd() when INIT_CWD is unset', () => {
        delete process.env.INIT_CWD;
        realpathSync.mockImplementation(p => p);

        expect(() => sanitizeDirectory('data/databases')).not.toThrow();
    });

    it('should throw when realpathSync fails (non-existent path)', () => {
        realpathSync.mockImplementation(() => { throw new Error('ENOENT'); });

        expect(() => sanitizeDirectory('data/databases')).toThrow('Invalid database directory');
    });

    it('should accept a valid subdirectory', () => {
        expect(() => sanitizeDirectory('data/databases')).not.toThrow();
    });

    it('should reject paths containing null bytes', () => {
        expect(() => sanitizeDirectory('data\0/databases')).toThrow('Invalid database directory');
    });

    it('should reject path traversal with ../', () => {
        expect(() => sanitizeDirectory('../../etc/passwd')).toThrow('Invalid database directory');
    });

    it('should reject deeply nested traversal attempts', () => {
        expect(() => sanitizeDirectory('../../../../../../../etc/shadow')).toThrow('Invalid database directory');
    });

    it('should reject absolute paths', () => {
        expect(() => sanitizeDirectory('/etc/passwd')).toThrow('Invalid database directory');
    });

    it('should reject directories that share the root prefix but are outside root', () => {
        // e.g., /app/project-backup should NOT pass for root /app/project
        realpathSync.mockImplementation(p => {
            if (p === rootDirectory) return rootDirectory;
            return `${rootDirectory}-backup`;
        });

        expect(() => sanitizeDirectory('data')).toThrow('Invalid database directory');
    });

    it('should follow symlinks when validating', () => {
        // Simulate a symlink that resolves outside the root
        realpathSync.mockImplementation(p => {
            if (p === rootDirectory) return rootDirectory;
            return '/somewhere/else';
        });

        expect(() => sanitizeDirectory('data')).toThrow('Invalid database directory');
    });

    it('should accept a path that resolves inside root via symlink', () => {
        realpathSync.mockImplementation(p => {
            if (p === rootDirectory) return rootDirectory;
            return `${rootDirectory}${sep}real-data`;
        });

        expect(() => sanitizeDirectory('data')).not.toThrow();
    });
});
