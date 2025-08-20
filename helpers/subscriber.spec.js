import {
    describe, it, expect, vi, beforeEach,
} from 'vitest';

vi.mock('bullmq', () => {
    const mockWorkerInstance = {
        close: vi.fn().mockResolvedValue(),
        on: vi.fn(),
    };
    const MockWorkerConstructor = vi.fn().mockImplementation(() => mockWorkerInstance);
    
    return {
        Worker: MockWorkerConstructor,
    };
});

vi.mock('./jobs.js', () => ({
    default: { host: 'localhost', port: 6379 },
}));

vi.mock('./log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
    },
}));

import subscriber from './subscriber';

describe('Subscriber', () => {
    let MockWorkerConstructor;
    let mockWorkerInstance;

    beforeEach(async () => {
        vi.clearAllMocks();
        
        // Get the mocked Worker constructor
        const { Worker } = await vi.importMock('bullmq');
        MockWorkerConstructor = Worker;
        
        // Get the current mock instance (the factory creates a new one each time)
        mockWorkerInstance = {
            close: vi.fn().mockResolvedValue(),
            on: vi.fn(),
        };
        MockWorkerConstructor.mockImplementation(() => mockWorkerInstance);
    });

    describe('when a new worker is created', () => {
        it('should create a worker successfully', () => {
            const result = subscriber.listen();

            expect(result).toBeUndefined();
        });

        it('should create worker with default queue name', () => {
            const callback = vi.fn();
            
            subscriber.listen(callback);

            expect(MockWorkerConstructor).toHaveBeenCalledWith(
                'notifications',
                expect.any(Function),
                {
                    connection: { host: 'localhost', port: 6379 },
                    concurrency: 5,
                }
            );
        });

        it('should create worker with custom queue name', () => {
            const callback = vi.fn();
            
            subscriber.listen(callback, 'custom-queue');

            expect(MockWorkerConstructor).toHaveBeenCalledWith(
                'custom-queue',
                expect.any(Function),
                {
                    connection: { host: 'localhost', port: 6379 },
                    concurrency: 5,
                }
            );
        });

        it('should set up event listeners', () => {
            const callback = vi.fn();
            
            subscriber.listen(callback);

            expect(mockWorkerInstance.on).toHaveBeenCalledWith('completed', expect.any(Function));
            expect(mockWorkerInstance.on).toHaveBeenCalledWith('failed', expect.any(Function));
            expect(mockWorkerInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
        });
    });

    describe('when processing jobs', () => {
        it('should process job with valid data', async () => {
            const callback = vi.fn().mockResolvedValue();
            const mockJob = {
                id: 'job-123',
                data: {
                    body: JSON.stringify({ name: 'Test User', phoneNumber: '+1234567890' }),
                    applicationProperties: {
                        claimCheckNumber: 'claim-456',
                        notificationType: 'Xur',
                        traceId: 'trace-789',
                    },
                },
            };

            subscriber.listen(callback);

            // Get the job processor function
            const jobProcessor = MockWorkerConstructor.mock.calls[0][1];
            
            await jobProcessor(mockJob);

            expect(callback).toHaveBeenCalledWith(
                { name: 'Test User', phoneNumber: '+1234567890' },
                {
                    claimCheckNumber: 'claim-456',
                    notificationType: 'Xur',
                }
            );
        });

        it('should handle job processing errors', async () => {
            const callback = vi.fn().mockRejectedValue(new Error('Processing failed'));
            const mockJob = {
                id: 'job-123',
                data: {
                    body: JSON.stringify({ name: 'Test User' }),
                    applicationProperties: {
                        claimCheckNumber: 'claim-456',
                        notificationType: 'Xur',
                        traceId: 'trace-789',
                    },
                },
            };

            subscriber.listen(callback);

            const jobProcessor = MockWorkerConstructor.mock.calls[0][1];
            
            await expect(jobProcessor(mockJob)).rejects.toThrow('Processing failed');
        });

        it('should handle malformed JSON in job body', async () => {
            const callback = vi.fn();
            const mockJob = {
                id: 'job-123',
                data: {
                    body: 'invalid-json',
                    applicationProperties: {
                        claimCheckNumber: 'claim-456',
                        notificationType: 'Xur',
                        traceId: 'trace-789',
                    },
                },
            };

            subscriber.listen(callback);

            const jobProcessor = MockWorkerConstructor.mock.calls[0][1];
            
            await expect(jobProcessor(mockJob)).rejects.toThrow();
        });
    });

    describe('when closing', () => {
        it('should close all workers', async () => {
            const callback = vi.fn();
            
            // Create multiple workers
            subscriber.listen(callback, 'queue1');
            subscriber.listen(callback, 'queue2');

            await subscriber.close();

            expect(mockWorkerInstance.close).toHaveBeenCalledTimes(2);
        });

        it('should handle close with no workers', async () => {
            await expect(subscriber.close()).resolves.not.toThrow();
        });
    });
});
