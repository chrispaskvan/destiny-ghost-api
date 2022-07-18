/**
 * Destiny Tracher Service Tests
 */
import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import DestinyTrackerService from './destinytracker.service';
import { post, get } from '../helpers/request';

vi.mock('../helpers/request');

let destinyTrackerService;

beforeEach(() => {
    destinyTrackerService = new DestinyTrackerService();
});

describe('DestinyTrackerService', () => {
    describe('getVotes', () => {
        it('should return the voting record', async () => {
            const mockVotes = {
                upvotes: 36,
                downvotes: 4,
                total: 40,
                score: 32,
            };

            post.mockImplementationOnce(() => Promise.resolve({ votes: mockVotes }));

            const votes = await destinyTrackerService.getVotes('3628991658');

            expect(votes).toEqual(mockVotes);
        });
    });

    describe('getRank', () => {
        describe('when rank is available', () => {
            it('should return the PVP rank', async () => {
                const mockRank = 1;
                const mockRanking = {
                    data: {
                        stats: {
                            rank: {
                                usage: mockRank,
                            },
                        },
                    },
                };

                get.mockImplementation(() => Promise.resolve(mockRanking));

                const rank = await destinyTrackerService.getRank('3628991658');

                expect(rank).toEqual(mockRank);
            });
        });

        describe('when rank is not available', () => {
            it('should return undefined', async () => {
                const mockRanking = {
                    data: {
                        stats: null,
                    },
                };

                get.mockImplementation(() => Promise.resolve(mockRanking));

                const rank = await destinyTrackerService.getRank('3628991658');

                expect(rank).toBeUndefined();
            });
        });
    });
});
