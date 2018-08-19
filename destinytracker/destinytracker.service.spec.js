/**
 * Destiny Tracher Service Tests
 */
const DestinyTrackerService = require('./destinytracker.service'),
	expect = require('chai').expect,
	request = require('request'),
	sinon = require('sinon');

let destinyTrackerService;

beforeEach(() => {
	destinyTrackerService = new DestinyTrackerService();
});

describe('DestinyTrackerService', () => {
	beforeEach(() => {
		this.request = sinon.stub(request, 'post');
	});

	describe('getVotes', () => {
		it('should return the voting record', () => {
			const mockVotes = {
				upvotes: 36,
				downvotes: 4,
				total: 40,
				score: 32
			};
			this.request.callsArgWith(1, undefined, { statusCode: 200 }, { votes: mockVotes});

			return destinyTrackerService.getVotes('3628991658')
				.then(votes => {
					expect(votes).to.eql(mockVotes);
				});
		});
	});

	describe('getRank', () => {
		describe('when rank is available', () => {
			it('should return the PVP rank', () => {
				const rank = 1;
				const mockRanking = {
					data: {
						itemInsights: {
							insights: {
								rank: {
									kills: rank
								}
							}
						}
					}
				};
				this.request.callsArgWith(1, undefined, { statusCode: 200 }, mockRanking);

				return destinyTrackerService.getRank('3628991658')
					.then(rank => {
						expect(rank).to.eql(rank);
					});
			});
		});

		describe('when rank is not available', () => {
			it('should return undefined', () => {
				const mockRanking = {
					data: {
						itemInsights: {
							insights: null
						}
					}
				};
				this.request.callsArgWith(1, undefined, { statusCode: 200 }, mockRanking);

				return destinyTrackerService.getRank('3628991658')
					.then(rank => {
						expect(rank).to.be.undefined;
					});
			});
		});
	});

	afterEach(() => {
		this.request.restore();
	});
});
