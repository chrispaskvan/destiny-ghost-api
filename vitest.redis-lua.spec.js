import { beforeEach, describe, expect, it } from 'vitest';
import { assertLua51, fakeRedis } from './vitest.redis-lua.js';

describe('assertLua51', () => {
    it.each([
        ['a guarded write', "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end"],
        ['pcall and cjson', 'local ok, value = pcall(cjson.decode, ARGV[1])'],
        ['tonumber comparisons', 'return tonumber(ARGV[1]) > tonumber(ARGV[2])'],
        ['"//" inside a string', "return '7 // 2'"],
        ['"//" inside a comment', '-- 7 // 2\nreturn 1'],
        ['an escaped backslash before x', "return '\\\\x41'"],
        ['"\\x" in a long string, which takes no escapes', 'return [[\\x41]]'],
        ['5.1 escapes', "return '\\n\\t\\65\\\\'"],
    ])('accepts %s', (_name, script) => {
        expect(() => assertLua51(script)).not.toThrow();
    });

    it.each([
        ['floor division', 'return 7 // 2'],
        ['goto', 'goto done\n::done::'],
        ['bitwise and', 'return 1 & 2'],
        ['bitwise or', 'return 1 | 2'],
        ['shifts', 'return 1 << 2'],
        ['a hex escape', "return '\\x41'"],
        ['a \\z escape', "return 'a\\z   b'"],
        ['a unicode escape', "return '\\u{41}'"],
    ])('rejects %s, which Lua 5.1 lacks', (_name, script) => {
        expect(() => assertLua51(script)).toThrow(/^Not Lua 5\.1, which Redis runs: \[\d+:\d+\]/);
    });
});

describe('fakeRedis', () => {
    /** @type {ReturnType<typeof fakeRedis>} */
    let redis;

    beforeEach(() => {
        redis = fakeRedis();
    });

    describe('eval', () => {
        it('passes KEYS and ARGV as 1-based arrays of strings', async () => {
            await expect(
                redis.eval('return { KEYS[1], ARGV[1], ARGV[2], type(ARGV[2]), #ARGV }', {
                    keys: ['k'],
                    arguments: ['a', '2'],
                }),
            ).resolves.toEqual(['k', 'a', '2', 'string', 2]);
        });

        it('defaults KEYS and ARGV to empty', async () => {
            await expect(redis.eval('return #KEYS + #ARGV')).resolves.toBe(0);
        });

        it('rejects a non-string argument, as node-redis does, before running', async () => {
            await expect(redis.eval('return 1', { arguments: ['a', 60] })).rejects.toThrow(
                new TypeError(
                    '"arguments[1]" must be of type "string | Buffer", got number instead.',
                ),
            );
        });

        it.each([
            ['true', 'return true', 1],
            ['false', 'return false', null],
            ['nil', 'return nil', null],
            ['a float, truncated', 'return 3.7', 3],
            ['a string', "return 'x'", 'x'],
            ['an array, up to the first nil', 'return { 1, "a", { 2 }, nil, 5 }', [1, 'a', [2]]],
            ['a status table', "return { ok = 'OK' }", 'OK'],
        ])('converts a returned %s the way Redis does', async (_name, script, reply) => {
            await expect(redis.eval(script)).resolves.toEqual(reply);
        });

        it('rejects with the message of a returned error table', async () => {
            await expect(redis.eval("return { err = 'nope' }")).rejects.toThrow('nope');
        });

        it('rejects with the line of a runtime error', async () => {
            await expect(redis.eval("\nerror('boom')")).rejects.toThrow('ERR user_script:2: boom');
        });

        it.each([
            ['an { err } table', "error({ err = 'NOPE not today' })", 'NOPE not today'],
            ['an { err } table without a code', "error({ err = 'nope' })", 'ERR nope'],
            ['any other table', 'error({})', 'ERR (error object is a table value)'],
            ['nil', 'error()', 'ERR (error object is a nil value)'],
        ])(
            'rejects with a readable message when a script raises %s',
            async (_name, script, message) => {
                await expect(redis.eval(script)).rejects.toThrow(new Error(message));
            },
        );

        it("keeps a failed command's error code rather than adding another", async () => {
            await expect(redis.eval("redis.call('EXPIRE', 'k', '1.5')")).rejects.toThrow(
                new Error('ERR value is not an integer or out of range'),
            );
        });

        it('parses the script as Lua 5.1 before running it', async () => {
            await expect(redis.eval("redis.call('SET', 'k', 'v') return 7 // 2")).rejects.toThrow(
                /^Not Lua 5\.1/,
            );
            await expect(redis.get('k')).resolves.toBeNull();
        });

        it.each([
            'math.tointeger',
            'math.type',
            'math.ult',
            'string.pack',
            'string.unpack',
            'table.move',
            'table.pack',
            'table.unpack',
            'math.maxinteger',
            'math.mininteger',
        ])('removes %s, which Lua 5.1 lacks', async name => {
            await expect(redis.eval(`return ${name} == nil`)).resolves.toBe(1);
        });

        it.each(['rawlen', 'utf8', 'io', 'os', 'debug', 'package', 'require', 'coroutine'])(
            'has no global %s, as Redis has none',
            async name => {
                await expect(redis.eval(`return ${name}`)).rejects.toThrow(
                    `Script attempted to access nonexistent global variable '${name}'`,
                );
            },
        );

        it("has 5.1's global unpack", async () => {
            await expect(redis.eval("return { unpack({ 'a', 'b' }) }")).resolves.toEqual([
                'a',
                'b',
            ]);
        });

        it('rejects a script that sets a global', async () => {
            await expect(redis.eval('x = 1')).rejects.toThrow('Attempt to modify a readonly table');
        });

        it('starts each script from a fresh state', async () => {
            await redis.eval('local t = cjson.decode(\'{"a":1}\') return 1');
            await expect(redis.eval('return t')).rejects.toThrow('nonexistent global');
        });
    });

    describe('redis.call', () => {
        it('gives a script false for a missing key or field', async () => {
            await expect(
                redis.eval(
                    "return { redis.call('GET', 'k') == false, redis.call('HGET', 'h', 'f') == false }",
                ),
            ).resolves.toEqual([1, 1]);
        });

        it('gives a script a status reply as { ok = "OK" }', async () => {
            await expect(redis.eval("return redis.call('SET', 'k', 'v').ok")).resolves.toBe('OK');
        });

        it('sends a number argument as its string form', async () => {
            await redis.eval("redis.call('SET', 'k', 60, 'EX', 90)");

            await expect(redis.get('k')).resolves.toBe('60');
            expect(redis.ttl('k')).toBe(90);
        });

        it('rejects an argument that is neither a string nor a number', async () => {
            await expect(redis.eval("redis.call('SET', 'k', true)")).rejects.toThrow(
                'Lua redis lib command arguments must be strings or integers',
            );
        });

        it('fails a script that calls a command the fake does not implement, naming it', async () => {
            await expect(redis.eval("redis.call('ZADD', 'z', 1, 'm')")).rejects.toThrow(
                "does not implement 'ZADD'",
            );
        });

        it('fails a script that uses an unimplemented SET option', async () => {
            await expect(redis.eval("redis.call('SET', 'k', 'v', 'PX', '5')")).rejects.toThrow(
                'implements only SET key value [EX seconds], not PX',
            );
        });

        it('fails a command on a key of the wrong type', async () => {
            redis.call('HSET', 'h', 'f', 'v');

            await expect(redis.eval("return redis.call('GET', 'h')")).rejects.toThrow('WRONGTYPE');
        });

        it('fails a command with the wrong number of arguments', async () => {
            await expect(redis.eval("redis.call('HSET', 'h', 'f')")).rejects.toThrow(
                "wrong number of arguments for 'hset' command",
            );
        });

        it('takes command names in any case', async () => {
            await expect(redis.eval("return redis.call('get', 'k')")).resolves.toBeNull();
        });
    });

    describe('commands', () => {
        it.each([
            ['not an integer', 'abc', 'ERR value is not an integer or out of range'],
            ['a float', '1.5', 'ERR value is not an integer or out of range'],
            ['in exponent form', '1e3', 'ERR value is not an integer or out of range'],
            ['zero', '0', "ERR invalid expire time in 'set' command"],
            ['negative', '-5', "ERR invalid expire time in 'set' command"],
        ])('SET rejects an EX that is %s, leaving the key as it was', (_name, seconds, message) => {
            redis.call('SET', 'k', 'old', 'EX', '60');

            expect(() => redis.call('SET', 'k', 'new', 'EX', seconds)).toThrow(new Error(message));
            expect(redis.call('GET', 'k')).toBe('old');
            expect(redis.ttl('k')).toBe(60);
        });

        it('EXPIRE rejects an expiry in exponent form', () => {
            redis.call('SET', 'k', 'v');

            expect(() => redis.call('EXPIRE', 'k', '1e3')).toThrow('not an integer');
        });

        it('SET without EX clears an earlier expiry', () => {
            redis.call('SET', 'k', 'a', 'EX', '60');
            redis.call('SET', 'k', 'b');

            expect(redis.ttl('k')).toBeUndefined();
        });

        it('DEL returns how many keys it removed', () => {
            redis.call('SET', 'a', '1');
            redis.call('HSET', 'b', 'f', '1');

            expect(redis.call('DEL', 'a', 'b', 'c')).toBe(2);
        });

        it('EXPIRE returns 0 for a missing key, and deletes on a non-positive expiry', () => {
            expect(redis.call('EXPIRE', 'k', '60')).toBe(0);

            redis.call('SET', 'k', 'v');
            expect(redis.call('EXPIRE', 'k', '60')).toBe(1);
            expect(redis.ttl('k')).toBe(60);

            redis.call('EXPIRE', 'k', '0');
            expect(redis.call('GET', 'k')).toBeNull();
        });

        it('EXPIRE rejects a non-integer expiry', () => {
            redis.call('SET', 'k', 'v');

            expect(() => redis.call('EXPIRE', 'k', '1.5')).toThrow('not an integer');
        });

        it('HSET sets several fields, returning how many are new, and keeps the expiry', () => {
            redis.call('HSET', 'h', 'a', '1');
            redis.call('EXPIRE', 'h', '60');

            expect(redis.call('HSET', 'h', 'a', '2', 'b', '3')).toBe(1);
            expect(redis.ttl('h')).toBe(60);
        });

        it('HSETNX sets only a missing field', () => {
            expect(redis.call('HSETNX', 'h', 'f', 'a')).toBe(1);
            expect(redis.call('HSETNX', 'h', 'f', 'b')).toBe(0);
            expect(redis.call('HGET', 'h', 'f')).toBe('a');
        });

        it('get and hGetAll reply as node-redis does', async () => {
            await expect(redis.get('missing')).resolves.toBeNull();
            await expect(redis.hGetAll('missing')).resolves.toEqual({});

            redis.call('HSET', 'h', 'a', '1', 'b', '2');
            await expect(redis.hGetAll('h')).resolves.toEqual({ a: '1', b: '2' });
        });
    });

    describe('cjson', () => {
        it('decodes objects and arrays into tables', async () => {
            await expect(
                redis.eval(
                    'local t = cjson.decode(ARGV[1]) return { type(t), t.s, t.n, t.list[1], #t.list }',
                    { arguments: ['{"s":"x","n":2,"list":["a","b"]}'] },
                ),
            ).resolves.toEqual(['table', 'x', 2, 'a', 2]);
        });

        it('decodes a whole number past 32 bits, as Redis keeps it as a double', async () => {
            await expect(
                redis.eval('local t = cjson.decode(ARGV[1]) return { t.at, cjson.encode(t) }', {
                    arguments: ['{"at":1700000000000}'],
                }),
            ).resolves.toEqual([1_700_000_000_000, '{"at":1700000000000}']);
        });

        it('decodes null as cjson.null, which is truthy', async () => {
            await expect(
                redis.eval(
                    "local t = cjson.decode('{\"sid\":null}') return { t.sid == cjson.null, t.sid and 'truthy' or 'falsy' }",
                ),
            ).resolves.toEqual([1, 'truthy']);
        });

        it('raises a decode error that pcall catches', async () => {
            await expect(
                redis.eval("local ok = pcall(cjson.decode, 'not json') return ok"),
            ).resolves.toBeNull();
        });

        it('round-trips an object, cjson.null included', async () => {
            const json = await redis.eval('return cjson.encode(cjson.decode(ARGV[1]))', {
                arguments: ['{"status":"sent","sid":null,"n":1.5,"list":[1,2]}'],
            });

            expect(JSON.parse(String(json))).toEqual({
                status: 'sent',
                sid: null,
                n: 1.5,
                list: [1, 2],
            });
        });

        it('encodes an empty table as an object', async () => {
            await expect(redis.eval('return cjson.encode({})')).resolves.toBe('{}');
        });

        it('escapes "/" as Redis\'s cjson does', async () => {
            await expect(redis.eval("return cjson.encode({ 'a/b' })")).resolves.toBe('["a\\/b"]');
        });

        it('refuses to encode a function', async () => {
            await expect(redis.eval('return cjson.encode({ f = print })')).rejects.toThrow(
                'Cannot serialise function',
            );
        });
    });
});
