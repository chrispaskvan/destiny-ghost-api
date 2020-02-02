/**
 * Destiny Tracher Service Tests
 */
const DestinyTrackerService = require('./destinytracker.service');
const request = require('../helpers/request');

jest.mock('../helpers/request');

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

            request.post.mockImplementation(() => Promise.resolve({ votes: mockVotes }));

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
                        itemInsights: {
                            insights: {
                                rank: {
                                    kills: mockRank,
                                },
                            },
                        },
                    },
                };

                request.post.mockImplementation(() => Promise.resolve(mockRanking));

                const rank = await destinyTrackerService.getRank('3628991658');

                expect(rank).toEqual(mockRank);
            });
        });

        describe('when rank is not available', () => {
            it('should return undefined', async () => {
                const mockRanking = {
                    data: {
                        itemInsights: {
                            insights: null,
                        },
                    },
                };

                request.post.mockImplementation(() => Promise.resolve(mockRanking));

                const rank = await destinyTrackerService.getRank('3628991658');

                expect(rank).toBeUndefined();
            });
        });
    });
});
