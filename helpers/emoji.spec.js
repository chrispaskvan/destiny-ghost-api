import { describe, expect, it } from 'vitest';
import { extractEmoji, normalizeEmoji, stripEmoji } from './emoji.js';

describe('extractEmoji()', () => {
    describe('when the text contains a single emoji', () => {
        it('should return an array with that emoji', () => {
            expect(extractEmoji('👍')).toEqual(['👍']);
        });
    });

    describe('when the text contains multiple emoji', () => {
        it('should return them in order of appearance', () => {
            expect(extractEmoji('👍 gjallarhorn 🔥')).toEqual(['👍', '🔥']);
        });
    });

    describe('when the text contains no emoji', () => {
        it('should return an empty array', () => {
            expect(extractEmoji('gjallarhorn')).toEqual([]);
        });
    });

    describe('when the text contains non-emoji unicode characters', () => {
        it('should not treat accented Latin characters as emoji', () => {
            expect(extractEmoji('café')).toEqual([]);
        });

        it('should not treat curly quotes as emoji', () => {
            expect(extractEmoji('Ana’s Rifle')).toEqual([]);
        });
    });

    describe('when called with no argument', () => {
        it('should return an empty array', () => {
            expect(extractEmoji()).toEqual([]);
        });
    });
});

describe('stripEmoji()', () => {
    describe('when the text is emoji-only', () => {
        it('should return an empty string', () => {
            expect(stripEmoji('👍')).toEqual('');
        });
    });

    describe('when the text combines words and emoji', () => {
        it('should remove the emoji and collapse the remaining whitespace', () => {
            expect(stripEmoji('gjallarhorn 🔥')).toEqual('gjallarhorn');
        });

        it('should remove emoji from the middle of a message', () => {
            expect(stripEmoji('gjallarhorn 🔥 rocket launcher')).toEqual(
                'gjallarhorn rocket launcher',
            );
        });
    });

    describe('when the text contains no emoji', () => {
        it('should return the trimmed text unchanged', () => {
            expect(stripEmoji('  gjallarhorn  ')).toEqual('gjallarhorn');
        });
    });

    describe('when called with no argument', () => {
        it('should return an empty string', () => {
            expect(stripEmoji()).toEqual('');
        });
    });
});

describe('normalizeEmoji()', () => {
    describe('when the emoji has a skin-tone modifier', () => {
        it('should strip the modifier down to the base emoji', () => {
            expect(normalizeEmoji('👎🏽')).toEqual('👎');
        });
    });

    describe('when the emoji has a variation selector', () => {
        it('should strip the selector down to the base emoji', () => {
            expect(normalizeEmoji('❤️')).toEqual('❤');
        });
    });

    describe('when the emoji is already a bare base sequence', () => {
        it('should return it unchanged', () => {
            expect(normalizeEmoji('❤')).toEqual('❤');
            expect(normalizeEmoji('👍')).toEqual('👍');
        });
    });

    describe('when called with no argument', () => {
        it('should return an empty string', () => {
            expect(normalizeEmoji()).toEqual('');
        });
    });
});
