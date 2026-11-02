import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

        it.each([
            ['an argument', { keys: ['k'], arguments: ['a', 60] }, 5],
            ['a key', { keys: ['k', 1] }, 4],
        ])(
            'rejects a non-string %s before running, numbered as node-redis numbers it',
            async (_name, options, index) => {
                // EVAL, the script and the key count come first.
                await expect(redis.eval('return 1', options)).rejects.toThrow(
                    new TypeError(
                        `"arguments[${index}]" must be of type "string | Buffer", got number instead.`,
                    ),
                );
            },
        );

        it.each([
            ['true', 'return true', 1],
            ['false', 'return false', null],
            ['nil', 'return nil', null],
            ['a float, truncated', 'return 3.7', 3],
            ['a string', "return 'x'", 'x'],
            ['an array, up to the first nil', 'return { 1, "a", { 2 }, nil, 5 }', [1, 'a', [2]]],
            ['a status table', "return { ok = 'OK' }", 'OK'],
            [
                'an array holding a status and an error',
                "return { 1, { ok = 'OK' }, { err = 'NOPE inner' } }",
                [1, 'OK', new Error('NOPE inner')],
            ],
        ])('converts a returned %s the way Redis does', async (_name, script, reply) => {
            await expect(redis.eval(script)).resolves.toEqual(reply);
        });

        it.each([
            ['math.huge', 'Infinity'],
            ['-math.huge', '-Infinity'],
            ['0/0', 'NaN'],
        ])(
            'refuses to reply with %s, which Redis has no defined conversion for',
            async (expr, shown) => {
                await expect(redis.eval(`return ${expr}`)).rejects.toThrow(
                    `cannot reply with ${shown}`,
                );
            },
        );

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

        it.each([
            'rawlen',
            'utf8',
            'io',
            'os',
            'debug',
            'package',
            'require',
            'dofile',
            'loadfile',
            'print',
        ])('has no global %s, as Redis has none', async name => {
            await expect(redis.eval(`return ${name}`)).rejects.toThrow(
                `Script attempted to access nonexistent global variable '${name}'`,
            );
        });

        it("opens coroutine, as 5.1's base library does, without 5.3's isyieldable", async () => {
            await expect(
                redis.eval('return { type(coroutine.wrap), coroutine.isyieldable == nil }'),
            ).resolves.toEqual(['function', 1]);
        });

        it('reports itself as Lua 5.1', async () => {
            await expect(redis.eval('return _VERSION')).resolves.toBe('Lua 5.1');
        });

        it.each(['bit', 'struct', 'cmsgpack', 'loadstring', 'gcinfo'])(
            'names %s, which Redis has, as not implemented here',
            async name => {
                await expect(redis.eval(`return ${name}`)).rejects.toThrow(
                    `the fake Redis in vitest.redis-lua.js does not implement '${name}'`,
                );
            },
        );

        it('names a redis.* function it does not provide as not implemented here', async () => {
            await expect(redis.eval("return redis.sha1hex('x')")).rejects.toThrow(
                'does not implement redis.sha1hex',
            );
        });

        it("has 5.1's global unpack", async () => {
            await expect(redis.eval("return { unpack({ 'a', 'b' }) }")).resolves.toEqual([
                'a',
                'b',
            ]);
        });

        it('rejects a script that sets a global', async () => {
            await expect(redis.eval('x = 1')).rejects.toThrow('Attempt to modify a readonly table');
        });

        it.each([
            ['an existing global', "_VERSION = 'changed'"],
            ['KEYS itself', 'KEYS = {}'],
            ['a global through _G', '_G.x = 1'],
            ['redis.call', 'redis.call = nil'],
            ['a string function', 'string.upper = nil'],
            ['a math field', 'math.pi = 3'],
            ['a table function', 'table.insert = nil'],
            ['a coroutine function', 'coroutine.wrap = nil'],
            ['a cjson function', 'cjson.encode = nil'],
        ])(
            'rejects a script that overwrites %s, as Redis keeps them read-only',
            async (_name, script) => {
                await expect(redis.eval(script)).rejects.toThrow(
                    /^ERR user_script:1: Attempt to modify a readonly table/,
                );
            },
        );

        it('lets a script change KEYS and ARGV, which Redis builds fresh for each call', async () => {
            await expect(
                redis.eval("KEYS[1] = 'changed' ARGV[2] = 'added' return { KEYS[1], #ARGV }", {
                    keys: ['k'],
                    arguments: ['a'],
                }),
            ).resolves.toEqual(['changed', 2]);
        });

        it('lets a script read the read-only libraries as tables', async () => {
            await expect(
                redis.eval(
                    'local n = 0 for _ in pairs(string) do n = n + 1 end return { n > 0, _G._VERSION, _G == _G._G }',
                ),
            ).resolves.toEqual([1, 'Lua 5.1', 1]);
        });

        it.each([
            [
                'a missing global',
                'return nope',
                "Script attempted to access nonexistent global variable 'nope'",
            ],
            ['an unimplemented global', 'return bit', "does not implement 'bit'"],
            [
                'an unimplemented redis function',
                "return redis.sha1hex('x')",
                'does not implement redis.sha1hex',
            ],
        ])('points the error for %s at the script', async (_name, script, message) => {
            await expect(redis.eval(script)).rejects.toThrow(`ERR user_script:1: `);
            await expect(redis.eval(script)).rejects.toThrow(message);
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

        it('raises a failed command as the { err } table Redis 7 raises', async () => {
            await expect(
                redis.eval(
                    "local ok, e = pcall(redis.call, 'EXPIRE', 'k', '1.5') return { tostring(ok), type(e), e.err }",
                ),
            ).resolves.toEqual(['false', 'table', 'ERR value is not an integer or out of range']);
        });

        it('gives an argument of the wrong type an ERR code', async () => {
            await expect(
                redis.eval("local ok, e = pcall(redis.call, 'GET', {}) return e.err"),
            ).resolves.toBe('ERR Lua redis lib command arguments must be strings or integers');
        });
    });

    describe('redis.pcall, error_reply and status_reply', () => {
        it('pcall returns a reply as call does', async () => {
            await expect(redis.eval("return redis.pcall('SET', 'k', 'v').ok")).resolves.toBe('OK');
        });

        it.each([
            [
                'a failed command',
                "redis.pcall('EXPIRE', 'k', '1.5')",
                'ERR value is not an integer or out of range',
            ],
            [
                'an argument of the wrong type',
                "redis.pcall('GET', {})",
                'ERR Lua redis lib command arguments must be strings or integers',
            ],
            [
                'an unimplemented command',
                "redis.pcall('ZADD', 'z', 1, 'm')",
                "ERR the fake Redis in vitest.redis-lua.js does not implement 'ZADD'",
            ],
        ])(
            'pcall returns the { err } table for %s rather than raising it',
            async (_name, expr, message) => {
                await expect(
                    redis.eval(`local e = ${expr} return { type(e), e.err }`),
                ).resolves.toEqual(['table', message]);
            },
        );

        it.each([
            ['with its own code', 'NOPE bad input', 'NOPE bad input'],
            ['without a code, gaining ERR', 'oops', 'ERR oops'],
            ['with a leading -', '-NOPE bad', 'NOPE bad'],
            ['taking its first word as the code, whatever its case', 'My error', 'My error'],
        ])('error_reply makes an error reply %s', async (_name, text, message) => {
            await expect(
                redis.eval('return redis.error_reply(ARGV[1])', { arguments: [text] }),
            ).rejects.toThrow(new Error(message));
        });

        it('status_reply makes a status reply', async () => {
            await expect(redis.eval("return redis.status_reply('FINE')")).resolves.toBe('FINE');
        });

        it.each(['error_reply', 'status_reply'])(
            '%s gives an error table when not given one string',
            async name => {
                await expect(redis.eval(`return redis.${name}()`)).rejects.toThrow(
                    new Error('ERR wrong number or type of arguments'),
                );
            },
        );
    });

    describe('expiry', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('expires a key once its time has passed, keeping it through its last millisecond', async () => {
            redis.call('SET', 'k', 'v', 'EX', '10');

            await vi.advanceTimersByTimeAsync(10_000);
            expect(redis.call('GET', 'k')).toBe('v');

            await vi.advanceTimersByTimeAsync(1);
            expect(redis.call('GET', 'k')).toBeNull();
            expect(redis.ttl('k')).toBe(-2);
        });

        it('counts the remaining time down, rounded as Redis rounds TTL', async () => {
            redis.call('SET', 'k', 'v', 'EX', '60');

            await vi.advanceTimersByTimeAsync(20_400);
            expect(redis.ttl('k')).toBe(40);

            await vi.advanceTimersByTimeAsync(200);
            expect(redis.ttl('k')).toBe(39);
        });

        it('lets EXPIRE extend a key, and finds nothing to extend once it has gone', async () => {
            redis.call('HSET', 'h', 'f', 'v');
            redis.call('EXPIRE', 'h', '10');

            await vi.advanceTimersByTimeAsync(5_000);
            expect(redis.call('EXPIRE', 'h', '10')).toBe(1);

            await vi.advanceTimersByTimeAsync(10_000);
            expect(redis.call('HGET', 'h', 'f')).toBe('v');

            await vi.advanceTimersByTimeAsync(1);
            expect(redis.call('EXPIRE', 'h', '10')).toBe(0);
        });

        it('treats an expired key as missing in a script and in DEL', async () => {
            redis.call('SET', 'k', 'v', 'EX', '1');
            await vi.advanceTimersByTimeAsync(1_001);

            await expect(redis.eval("return redis.call('GET', 'k') == false")).resolves.toBe(1);
            expect(redis.call('DEL', 'k')).toBe(0);
        });

        it('lets a key without an expiry live on', async () => {
            redis.call('SET', 'k', 'v');
            await vi.advanceTimersByTimeAsync(365 * 86_400_000);

            expect(redis.call('GET', 'k')).toBe('v');
        });
    });

    describe('commands', () => {
        it.each([
            ['not an integer', 'abc', 'ERR value is not an integer or out of range'],
            ['a float', '1.5', 'ERR value is not an integer or out of range'],
            ['in exponent form', '1e3', 'ERR value is not an integer or out of range'],
            ['zero', '0', "ERR invalid expire time in 'set' command"],
            ['negative', '-5', "ERR invalid expire time in 'set' command"],
            ['-0', '-0', 'ERR value is not an integer or out of range'],
            [
                'past 64-bit milliseconds',
                '9223372036854776',
                "ERR invalid expire time in 'set' command",
            ],
            [
                'past 64-bit milliseconds once the time now is added',
                '9223372036854775',
                "ERR invalid expire time in 'set' command",
            ],
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

        it.each([
            ['-0', '-0', 'ERR value is not an integer or out of range'],
            ['a leading zero', '007', 'ERR value is not an integer or out of range'],
            ['a plus sign', '+5', 'ERR value is not an integer or out of range'],
            ['past 64 bits', '9223372036854775808', 'ERR value is not an integer or out of range'],
            ['310 digits', '9'.repeat(310), 'ERR value is not an integer or out of range'],
            [
                'more seconds than fit in 64-bit milliseconds',
                '9223372036854776',
                "ERR invalid expire time in 'expire' command",
            ],
            [
                'as many negative',
                '-9223372036854776',
                "ERR invalid expire time in 'expire' command",
            ],
            [
                'an expiry that overflows once the time now is added',
                '9223372036854775',
                "ERR invalid expire time in 'expire' command",
            ],
        ])('EXPIRE rejects %s, leaving the key as it was', (_name, seconds, message) => {
            redis.call('SET', 'k', 'v', 'EX', '60');

            expect(() => redis.call('EXPIRE', 'k', seconds)).toThrow(new Error(message));
            expect(redis.call('GET', 'k')).toBe('v');
            expect(redis.ttl('k')).toBe(60);
        });

        it('EXPIRE takes the most negative expiry that fits, deleting the key', () => {
            redis.call('SET', 'k', 'v');

            expect(redis.call('EXPIRE', 'k', '-9223372036854775')).toBe(1);
            expect(redis.call('GET', 'k')).toBeNull();
        });

        it('SET without EX clears an earlier expiry, keeping the key', () => {
            redis.call('SET', 'k', 'a', 'EX', '60');
            redis.call('SET', 'k', 'b');

            expect(redis.ttl('k')).toBe(-1);
            expect(redis.call('GET', 'k')).toBe('b');
        });

        it('ttl answers -2 for a key that does not exist, as Redis does', () => {
            expect(redis.ttl('missing')).toBe(-2);
        });

        it.each([
            ['NX', ['NX'], 'not NX'],
            ['GET', ['GET'], 'not GET'],
            ['KEEPTTL', ['KEEPTTL'], 'not KEEPTTL'],
            ['NX after EX', ['EX', '10', 'NX'], 'not NX'],
        ])('SET names an option it does not implement: %s', (_name, options, message) => {
            expect(() => redis.call('SET', 'k', 'v', ...options)).toThrow(message);
        });

        it.each([
            ['EX without seconds', ['EX']],
            ['EX twice', ['EX', '10', 'EX', '20']],
        ])('SET rejects %s as a syntax error', (_name, options) => {
            expect(() => redis.call('SET', 'k', 'v', ...options)).toThrow(
                new Error('ERR syntax error'),
            );
        });

        it('call takes only strings, as node-redis does, so the store holds only strings', () => {
            expect(() => redis.call('HSET', 'h', 'f', /** @type {any} */ (1))).toThrow(
                new TypeError(
                    '"arguments[3]" must be of type "string | Buffer", got number instead.',
                ),
            );
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
            await expect(redis.eval('return cjson.encode({ f = tostring })')).rejects.toThrow(
                'Cannot serialise function',
            );
        });

        it('refuses a table key that is neither a number nor a string', async () => {
            await expect(redis.eval('return cjson.encode({ [true] = 1 })')).rejects.toThrow(
                'Cannot serialise boolean: table key must be a number or string',
            );
        });

        it.each([
            ['0.1 + 0.2', '0.3'],
            ['1.5', '1.5'],
            ['tonumber("12345678901234")', '12345678901234'],
            ['tonumber("1700000000123456")', '1.7000000001235e+15'],
            ['tonumber("1e14")', '1e+14'],
            ['0.00001', '1e-05'],
            ['0.0001', '0.0001'],
            ['-2.5', '-2.5'],
        ])('encodes %s to 14 significant digits, as Redis cjson does', async (expr, json) => {
            await expect(redis.eval(`return cjson.encode({ ${expr} })`)).resolves.toBe(`[${json}]`);
        });

        it('encodes a sparse array with null in its gaps', async () => {
            await expect(redis.eval('return cjson.encode({ 1, 2, nil, 4 })')).resolves.toBe(
                '[1,2,null,4]',
            );
        });

        it('refuses an array too sparse to encode', async () => {
            await expect(
                redis.eval('local t = {} t[1] = 1 t[20] = 2 return cjson.encode(t)'),
            ).rejects.toThrow('excessively sparse array');
        });

        it('encodes a table with any non-index key as an object', async () => {
            const json = await redis.eval("return cjson.encode({ 1, a = 'b' })");

            expect(JSON.parse(String(json))).toEqual({ 1: 1, a: 'b' });
        });
    });
});
