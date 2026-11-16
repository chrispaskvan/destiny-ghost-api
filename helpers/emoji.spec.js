import { describe, expect, it } from 'vitest';
import { extractEmoji, normalizeEmoji, parseReaction, stripEmoji, toKeyword } from './emoji.js';

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

describe('stripEmoji() leftovers', () => {
    it.each([
        ['a variation selector emoji-regex leaves after 👍', '👍\u{FE0F}'],
        ['a text-presentation selector', '👍\u{FE0E}'],
        ['a zero-width joiner between emoji', '🦄\u{200D}🔥'],
    ])('should remove %s', (_, text) => {
        expect(stripEmoji(text)).toBe('');
    });
});

describe('parseReaction()', () => {
    it.each([
        ['Reacted 👍 to “Got it 👍”', '👍'],
        ['Reacted 👍🏽 to “Got it”', '👍'],
        ['Reacted ❤️ to "Glad to help!"', '❤'],
        ['Reacted 👍\u{FE0F} to “Got it”', '👍'],
        ['Reacted 🔥 to an image', '🔥'],
        ['Liked “Got it 👍”', '👍'],
        ['Loved “Glad to help!”', '❤'],
        ['Disliked “Are you sure that’s how it’s spelled?”', '👎'],
        ['Laughed at “😂”', '😂'],
        ['Emphasized “Got it”', '‼'],
        ['Questioned “Got it”', '❓'],
        ['Liked an image', '👍'],
        ['Liked “two\nlines”', '👍'],
    ])('should read %j as %s', (text, emoji) => {
        expect(parseReaction(text)).toEqual({ emoji });
    });

    it.each([
        'Reacted with a sticker to “Got it”',
        'Reacted 👍🔥 to “Got it”',
        'Reacted badly to “Got it”',
    ])('should read %j as a reaction without one emoji to answer', text => {
        expect(parseReaction(text)).toEqual({});
    });

    it.each(['Removed a like from “Got it”', 'Removed 👍 from “Got it”'])(
        'should read %j as taking a reaction back',
        text => {
            expect(parseReaction(text)).toEqual({ removed: true });
        },
    );

    it.each([
        'gjallarhorn',
        '👍',
        'Liked gjallarhorn',
        'Reacted 👍 to gjallarhorn',
        'I liked “Got it”',
        '',
    ])('should not read %j as a reaction', text => {
        expect(parseReaction(text)).toBeUndefined();
    });
});

describe('toKeyword()', () => {
    it.each([
        ['STOP', 'stop'],
        ['  Stop 🔥 ', 'stop'],
        ['STOP\u{200D}', 'stop'],
        ['HELP\u{FE0F}', 'help'],
    ])('should read %j as %j', (text, keyword) => {
        expect(toKeyword(text)).toBe(keyword);
    });
});
