// @ts-check
import fengari from 'fengari';
import luaparse from 'luaparse';

/**
 * Runs the repo's Redis Lua scripts in specs, in place of hand-written
 * JavaScript copies of them (#777).
 *
 * `fakeRedis()` is a small in-memory Redis: `eval` runs the real script in a
 * Lua VM (fengari), against a store that plain commands (`get`, `hGetAll`)
 * read too. It mimics what Redis does to a script, not just what the
 * scripts happen to need today:
 *
 * Where it says what Redis does, that is Redis 7.2's `script_lua.c`.
 *
 * - Redis runs Lua 5.1 and fengari runs 5.3, so every script is parsed as 5.1
 *   first, and the library functions 5.3 added are removed. `_VERSION` reads
 *   `Lua 5.1`.
 * - Only the libraries Redis loads are open: base (with `coroutine`, which
 *   5.1's base opens), string, table and math, plus `redis.call` and `cjson`.
 *   `dofile`, `loadfile` and `print` are gone, as Redis removes them. Globals
 *   are read-only, and reading a missing one is an error.
 * - Replies convert between Redis and Lua the way Redis converts them:
 *   - a missing value is `false` in Lua, and a status reply `{ ok = 'OK' }`;
 *   - a failed command raises `{ err = 'CODE message' }`, so `pcall` sees
 *     the table Redis raises;
 *   - a returned number comes back truncated to an integer;
 *   - an `{ err }` table inside a returned array becomes an `Error` element.
 * - Keys expire, lazily, against `Date.now()`, so Vitest's fake timers drive
 *   them.
 * - `cjson` follows Redis's: `cjson.null` is a distinct value, truthy in
 *   Lua; `encode` escapes `/` and writes a sparse array with `null` in its
 *   gaps, refusing one that is too sparse.
 * - `eval` takes node-redis's `{ keys, arguments }` and, like node-redis,
 *   rejects an argument that isn't a string.
 *
 * A command the fake doesn't implement fails the script, naming it, rather
 * than doing nothing. So does a reply Redis has no defined conversion for
 * (a returned `math.huge` or `0/0`).
 *
 * What it can't match: numbers inside the script. Redis's Lua 5.1 has only
 * doubles. fengari's 5.3 also has integers, 32-bit ones that wrap on
 * overflow, and prints a whole float as `5.0` where 5.1 prints `5`; a number
 * `cjson` decodes past 2^31 is such a float. So arithmetic past 2^31, or
 * building a string from a number with `..` or `tostring`, can differ from
 * Redis. None of the repo's scripts does either. Keep numbers as strings
 * where you can, and compare them with `tonumber`. Numbers passed to
 * `redis.call` are fine: Redis writes an integer exactly and anything else
 * in its shortest round-trip form, as JavaScript's `String()` does. `load`
 * also accepts a string here, where 5.1's takes only a function.
 */

const { lua, lauxlib, lualib, luaconf, to_jsstring, to_luastring } = fengari;

/**
 * String escapes added after 5.1, which luaparse accepts even in 5.1 mode.
 * Lua 5.1 reads an unknown escape as the character alone, so on Redis
 * `'\x41'` is `'x41'`, not `'A'`.
 */
const NEWER_ESCAPES = new Set(['x', 'z', 'u']);

/**
 * luaparse's hook for each string literal: throws on an escape 5.1 lacks.
 * Long strings (`[[...]]`) process no escapes, so they are skipped.
 * @param {{ type: string, raw?: string, loc?: { start: { line: number, column: number } } }} node
 */
const rejectNewerEscapes = node => {
    if (node.type !== 'StringLiteral' || !node.raw || node.raw.startsWith('[')) return;

    for (const [, escaped] of node.raw.matchAll(/\\([\s\S])/g)) {
        if (NEWER_ESCAPES.has(escaped)) {
            const { line, column } = node.loc?.start ?? { line: 0, column: 0 };

            throw new SyntaxError(
                `[${line}:${column + 1}] escape '\\${escaped}' is not Lua 5.1 near ${node.raw}`,
            );
        }
    }
};

/**
 * Throws if `script` is not valid Lua 5.1, naming where it stops parsing.
 * @param {string} script
 */
export const assertLua51 = script => {
    try {
        luaparse.parse(script, {
            luaVersion: '5.1',
            locations: true,
            onCreateNode: rejectNewerEscapes,
        });
    } catch (error) {
        // luaparse throws a SyntaxError carrying `[line:column] reason`.
        const { message } = /** @type {SyntaxError} */ (error);

        throw new Error(`Not Lua 5.1, which Redis runs: ${message}`, { cause: error });
    }
};

/** `cjson.null`, pushed into Lua as a light userdata with this identity. */
const CJSON_NULL = Object.freeze({});

/**
 * The libraries Redis opens for scripts, and the 5.3 additions to remove.
 * `table.unpack` goes too, after it has become the global `unpack`, its 5.1
 * name. Other 5.1 functions 5.3 dropped (`math.pow`, `table.getn`, ...) are
 * simply missing, so a script using one fails here rather than passing.
 */
const LIBRARIES = [
    ['_G', lualib.luaopen_base, ['rawlen', 'dofile', 'loadfile', 'print']],
    ['coroutine', lualib.luaopen_coroutine, ['isyieldable']],
    ['string', lualib.luaopen_string, ['pack', 'packsize', 'unpack']],
    ['table', lualib.luaopen_table, ['move', 'pack', 'unpack']],
    ['math', lualib.luaopen_math, ['maxinteger', 'mininteger', 'tointeger', 'type', 'ult']],
];

/** Redis's guard against scripts touching globals, set after setup. */
const PROTECT_GLOBALS = `
setmetatable(_G, {
    __index = function(_, name)
        error("Script attempted to access nonexistent global variable '" .. tostring(name) .. "'", 2)
    end,
    __newindex = function(_, name)
        error("Attempt to modify a readonly table: '" .. tostring(name) .. "'", 2)
    end,
})
`;

const WRONGTYPE = 'WRONGTYPE Operation against a key holding the wrong kind of value';

/**
 * `expiresAt` is in epoch milliseconds, against `Date.now()`.
 * @typedef {{ type: 'string', value: string, expiresAt?: number }
 *     | { type: 'hash', value: Map<string, string>, expiresAt?: number }} Entry
 * @typedef {string | number | null | { ok: string } | Reply[]} Reply
 */

/**
 * @param {string} message
 * @returns {never}
 */
const fail = message => {
    throw new Error(message);
};

/**
 * Parses an integer argument as Redis does: digits only, so not `''`,
 * `'1.5'` or `'1e3'`.
 * @param {string} value
 * @returns {number}
 */
const integerArgument = value =>
    /^-?\d+$/.test(value) ? Number(value) : fail('ERR value is not an integer or out of range');

/**
 * Pushes a number as 5.1 would hold it. A whole number fits fengari's 32-bit
 * integers or goes in as a float; pushing a larger one as an integer fails.
 * @param {any} L
 * @param {number} value
 */
const pushNumber = (L, value) => {
    if (Number.isInteger(value) && Math.abs(value) <= luaconf.LUA_MAXINTEGER) {
        lua.lua_pushinteger(L, value);
    } else {
        lua.lua_pushnumber(L, value);
    }
};

/**
 * An error message with a Redis error code, adding `ERR` when it has none,
 * as Redis does.
 * @param {string} message
 * @returns {string}
 */
const withCode = message => (/^[A-Z]+ /.test(message) ? message : `ERR ${message}`);

/**
 * Raises a failed command's error inside Lua as Redis 7 raises it: a table
 * whose `err` field holds the coded message.
 * @param {any} L
 * @param {unknown} error
 * @returns {number}
 */
const raiseReplyError = (L, error) => {
    lua.lua_createtable(L, 0, 1);
    lua.lua_pushstring(L, to_luastring(withCode(/** @type {Error} */ (error).message)));
    lua.lua_setfield(L, -2, to_luastring('err'));

    return lua.lua_error(L);
};

/**
 * Raises `error` inside Lua, as the error a script sees. `lua_error` never
 * returns; a C function returns its result, by convention.
 * @param {any} L
 * @param {unknown} error
 * @returns {number}
 */
const raise = (L, error) => {
    lua.lua_pushstring(L, to_luastring(/** @type {Error} */ (error).message));

    return lua.lua_error(L);
};

/**
 * @param {any} L
 * @param {number} index
 * @returns {string}
 */
const stringAt = (L, index) => to_jsstring(lua.lua_tolstring(L, index));

/**
 * Pushes a command's reply the way Redis converts it for Lua.
 * @param {any} L
 * @param {Reply} reply
 */
const pushReply = (L, reply) => {
    if (reply === null) {
        lua.lua_pushboolean(L, false);
    } else if (typeof reply === 'number') {
        pushNumber(L, reply);
    } else if (typeof reply === 'string') {
        lua.lua_pushstring(L, to_luastring(reply));
    } else if (Array.isArray(reply)) {
        lua.lua_createtable(L, reply.length, 0);
        reply.forEach((item, i) => {
            pushReply(L, item);
            lua.lua_rawseti(L, -2, i + 1);
        });
    } else {
        lua.lua_createtable(L, 0, 1);
        lua.lua_pushstring(L, to_luastring(reply.ok));
        lua.lua_setfield(L, -2, to_luastring('ok'));
    }
};

/**
 * Converts a script's return value the way Redis converts it for the caller.
 * An `{ err }` table rejects the reply, or, inside an array, becomes an
 * `Error` element, as node-redis hands back an error inside an array reply.
 * @param {any} L
 * @param {number} index
 * @param {boolean} [nested] - whether this is an element of an array reply
 * @returns {string | number | null | Error | Array<unknown>}
 */
const replyFrom = (L, index, nested = false) => {
    const at = lua.lua_absindex(L, index);

    switch (lua.lua_type(L, at)) {
        case lua.LUA_TBOOLEAN:
            return lua.lua_toboolean(L, at) ? 1 : null;
        case lua.LUA_TNUMBER: {
            const number = lua.lua_tonumber(L, at);

            return Number.isFinite(number)
                ? Math.trunc(number)
                : fail(
                      `ERR the fake cannot reply with ${number}: Redis casts it to an integer, with a result that depends on the platform`,
                  );
        }
        case lua.LUA_TSTRING:
            return stringAt(L, at);
        case lua.LUA_TTABLE: {
            for (const field of ['err', 'ok']) {
                lua.lua_getfield(L, at, to_luastring(field));
                const value = lua.lua_type(L, -1) === lua.LUA_TSTRING ? stringAt(L, -1) : null;
                lua.lua_pop(L, 1);
                if (value !== null && field === 'err') {
                    if (nested) return new Error(value);
                    fail(value);
                }
                if (value !== null) return value;
            }

            const items = [];

            for (let i = 1; lua.lua_rawgeti(L, at, i) !== lua.LUA_TNIL; i++) {
                items.push(replyFrom(L, -1, true));
                lua.lua_pop(L, 1);
            }
            lua.lua_pop(L, 1);

            return items;
        }
        default:
            return null;
    }
};

/**
 * Pushes a decoded JSON value: `null` becomes `cjson.null`, arrays 1-based.
 * @param {any} L
 * @param {unknown} value
 */
const pushJson = (L, value) => {
    if (value === null) {
        lua.lua_pushlightuserdata(L, CJSON_NULL);
    } else if (typeof value === 'boolean') {
        lua.lua_pushboolean(L, value);
    } else if (typeof value === 'number') {
        pushNumber(L, value);
    } else if (typeof value === 'string') {
        lua.lua_pushstring(L, to_luastring(value));
    } else if (Array.isArray(value)) {
        lua.lua_createtable(L, value.length, 0);
        value.forEach((item, i) => {
            pushJson(L, item);
            lua.lua_rawseti(L, -2, i + 1);
        });
    } else {
        const entries = Object.entries(/** @type {object} */ (value));

        lua.lua_createtable(L, 0, entries.length);
        for (const [key, item] of entries) {
            pushJson(L, item);
            lua.lua_setfield(L, -2, to_luastring(key));
        }
    }
};

/**
 * Reads a Lua value for `cjson.encode`, with Redis's cjson defaults. A table
 * whose keys are all positive integers is an array, `null` in any gap; one
 * whose largest key is over 10 and over twice its count is refused as too
 * sparse. Any other table, an empty one included, is an object.
 * @param {any} L
 * @param {number} index
 * @returns {unknown}
 */
const jsonFrom = (L, index) => {
    const at = lua.lua_absindex(L, index);
    const type = lua.lua_type(L, at);

    switch (type) {
        case lua.LUA_TNIL:
            return null;
        case lua.LUA_TBOOLEAN:
            return lua.lua_toboolean(L, at);
        case lua.LUA_TNUMBER: {
            const number = lua.lua_tonumber(L, at);

            return Number.isFinite(number)
                ? number
                : fail('Cannot serialise number: must not be NaN or Inf');
        }
        case lua.LUA_TSTRING:
            return stringAt(L, at);
        case lua.LUA_TLIGHTUSERDATA:
            if (lua.lua_touserdata(L, at) === CJSON_NULL) return null;
            break;
        case lua.LUA_TTABLE: {
            /** @type {Array<[string | number, unknown]>} */
            const entries = [];

            lua.lua_pushnil(L);
            while (lua.lua_next(L, at)) {
                // Read a number key without lua_tolstring, which would
                // convert it in place and break lua_next.
                const key =
                    lua.lua_type(L, -2) === lua.LUA_TNUMBER
                        ? lua.lua_tonumber(L, -2)
                        : stringAt(L, -2);

                entries.push([key, jsonFrom(L, -1)]);
                lua.lua_pop(L, 1);
            }

            const isArray =
                entries.length > 0 &&
                entries.every(
                    ([key]) => typeof key === 'number' && Number.isInteger(key) && key >= 1,
                );

            if (isArray) {
                const length = Math.max(...entries.map(([key]) => Number(key)));

                if (length > entries.length * 2 && length > 10) {
                    fail('Cannot serialise table: excessively sparse array');
                }

                /** @type {unknown[]} */
                const array = Array(length).fill(null);

                for (const [key, item] of entries) array[Number(key) - 1] = item;

                return array;
            }

            return Object.fromEntries(entries.map(([key, item]) => [String(key), item]));
        }
    }

    return fail(`Cannot serialise ${to_jsstring(lua.lua_typename(L, type))}`);
};

/**
 * The error reply for a failed script, from the error value it raised: a
 * string, an `{ err = ... }` table as Redis reads one, or, for anything
 * else, its type. A message that already carries a Redis error code (a
 * command's `ERR ...`, `WRONGTYPE ...`) keeps it rather than gaining another.
 * @param {any} L
 * @returns {string}
 */
const errorFrom = L => {
    const type = lua.lua_type(L, -1);
    let message;

    if (type === lua.LUA_TSTRING || type === lua.LUA_TNUMBER) {
        message = stringAt(L, -1);
    } else if (
        type === lua.LUA_TTABLE &&
        lua.lua_getfield(L, -1, to_luastring('err')) === lua.LUA_TSTRING
    ) {
        message = stringAt(L, -1);
    } else {
        message = `(error object is a ${to_jsstring(lua.lua_typename(L, type))} value)`;
    }

    return withCode(message);
};

/**
 * Sets a global table of functions.
 * @param {any} L
 * @param {string} name
 * @param {Record<string, (L: any) => number>} functions
 */
const setLibrary = (L, name, functions) => {
    lua.lua_createtable(L, 0, Object.keys(functions).length);
    for (const [key, fn] of Object.entries(functions)) {
        lua.lua_pushcfunction(L, fn);
        lua.lua_setfield(L, -2, to_luastring(key));
    }
    lua.lua_setglobal(L, to_luastring(name));
};

/**
 * Sets a global array of strings, as Redis sets `KEYS` and `ARGV`.
 * @param {any} L
 * @param {string} name
 * @param {string[]} values
 */
const setStrings = (L, name, values) => {
    pushReply(L, values);
    lua.lua_setglobal(L, to_luastring(name));
};

/**
 * Checks arguments the way node-redis's encoder does, before anything is sent.
 * @param {unknown[]} values
 * @returns {string[]}
 */
const encoded = values =>
    values.map((value, i) => {
        if (typeof value === 'string') return value;
        if (value instanceof Buffer) return value.toString();

        throw new TypeError(
            `"arguments[${i}]" must be of type "string | Buffer", got ${typeof value} instead.`,
        );
    });

export const fakeRedis = () => {
    /** @type {Map<string, Entry>} */
    const store = new Map();

    /**
     * The entry at `key`, deleting it first if it has expired.
     * @param {string} key
     */
    const live = key => {
        const entry = store.get(key);

        if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
            store.delete(key);

            return undefined;
        }

        return entry;
    };

    /** @param {number} seconds */
    const expiresIn = seconds => Date.now() + seconds * 1000;

    /**
     * @param {string} key
     * @param {Entry['type']} type
     */
    const entryOf = (key, type) => {
        const entry = live(key);

        if (entry && entry.type !== type) fail(WRONGTYPE);

        return entry;
    };

    /** @param {string} key */
    const hashOf = key =>
        /** @type {Map<string, string> | undefined} */ (entryOf(key, 'hash')?.value);

    /** @param {string} key */
    const createHash = key => {
        const hash = hashOf(key) ?? new Map();

        if (!store.has(key)) store.set(key, { type: 'hash', value: hash });

        return hash;
    };

    /**
     * @param {string} name
     * @param {string[]} args
     * @param {(n: number) => boolean} ok
     */
    const arity = (name, args, ok) => {
        if (!ok(args.length))
            fail(`ERR wrong number of arguments for '${name.toLowerCase()}' command`);
    };

    /** @type {Record<string, (...args: string[]) => Reply>} */
    const commands = {
        GET: (...args) => {
            arity('GET', args, n => n === 1);

            return /** @type {string | undefined} */ (entryOf(args[0], 'string')?.value) ?? null;
        },
        SET: (...args) => {
            arity('SET', args, n => n === 2 || n === 4);

            const [key, value, option, seconds] = args;

            if (option !== undefined && option.toUpperCase() !== 'EX') {
                fail(
                    `ERR the fake Redis implements only SET key value [EX seconds], not ${option}`,
                );
            }

            const ttl = seconds === undefined ? undefined : integerArgument(seconds);

            if (ttl !== undefined && ttl <= 0) fail("ERR invalid expire time in 'set' command");

            store.set(key, {
                type: 'string',
                value,
                ...(ttl !== undefined && { expiresAt: expiresIn(ttl) }),
            });

            return { ok: 'OK' };
        },
        DEL: (...args) => {
            arity('DEL', args, n => n >= 1);

            return args.filter(key => live(key) && store.delete(key)).length;
        },
        EXPIRE: (...args) => {
            arity('EXPIRE', args, n => n === 2);

            const [key, seconds] = args;
            const ttl = integerArgument(seconds);
            const entry = live(key);

            if (!entry) return 0;
            if (ttl <= 0) store.delete(key);
            else entry.expiresAt = expiresIn(ttl);

            return 1;
        },
        HGET: (...args) => {
            arity('HGET', args, n => n === 2);

            return hashOf(args[0])?.get(args[1]) ?? null;
        },
        HGETALL: (...args) => {
            arity('HGETALL', args, n => n === 1);

            return [...(hashOf(args[0]) ?? [])].flat();
        },
        HSET: (...args) => {
            arity('HSET', args, n => n >= 3 && n % 2 === 1);

            const [key, ...pairs] = args;
            const hash = createHash(key);
            let added = 0;

            for (let i = 0; i < pairs.length; i += 2) {
                if (!hash.has(pairs[i])) added++;
                hash.set(pairs[i], pairs[i + 1]);
            }

            return added;
        },
        HSETNX: (...args) => {
            arity('HSETNX', args, n => n === 3);

            const [key, field, value] = args;
            const hash = createHash(key);

            if (hash.has(field)) return 0;
            hash.set(field, value);

            return 1;
        },
    };

    /**
     * Runs one command, as `redis.call` would.
     * @param {string} name
     * @param {...string} args
     * @returns {Reply}
     */
    const call = (name, ...args) => {
        const command = commands[name.toUpperCase()];

        if (!command) {
            fail(`ERR the fake Redis in vitest.redis-lua.js does not implement '${name}'`);
        }

        return command(...args);
    };

    /** @param {any} L */
    const redisCall = L => {
        const args = [];

        for (let i = 1; i <= lua.lua_gettop(L); i++) {
            const type = lua.lua_type(L, i);

            if (type === lua.LUA_TNUMBER) {
                args.push(String(lua.lua_tonumber(L, i)));
            } else if (type === lua.LUA_TSTRING) {
                args.push(stringAt(L, i));
            } else {
                return raiseReplyError(
                    L,
                    new Error('Lua redis lib command arguments must be strings or integers'),
                );
            }
        }

        let reply;

        try {
            reply = call(args[0] ?? '', ...args.slice(1));
        } catch (error) {
            return raiseReplyError(L, error);
        }
        pushReply(L, reply);

        return 1;
    };

    /** @param {any} L */
    const decode = L => {
        try {
            pushJson(L, JSON.parse(to_jsstring(lauxlib.luaL_checkstring(L, 1))));
        } catch (error) {
            return raise(L, error);
        }

        return 1;
    };

    /** @param {any} L */
    const encode = L => {
        let json;

        try {
            // Redis's cjson escapes "/", which JSON.stringify leaves alone.
            json = JSON.stringify(jsonFrom(L, 1)).replaceAll('/', '\\/');
        } catch (error) {
            return raise(L, error);
        }
        lua.lua_pushstring(L, to_luastring(json));

        return 1;
    };

    /**
     * Runs `script` in a fresh Lua state, as Redis's EVAL would.
     * @param {string} script
     * @param {{ keys?: unknown[], arguments?: unknown[] }} [options]
     */
    const evaluate = async (script, { keys = [], arguments: argv = [] } = {}) => {
        const keyStrings = encoded(keys);
        const argStrings = encoded(argv);

        assertLua51(script);

        const L = lauxlib.luaL_newstate();

        for (const [name, open, newer] of LIBRARIES) {
            lauxlib.luaL_requiref(L, to_luastring(name), open, 1);
            if (name === 'table') {
                lua.lua_getfield(L, -1, to_luastring('unpack'));
                lua.lua_setglobal(L, to_luastring('unpack'));
            }
            for (const field of newer) {
                lua.lua_pushnil(L);
                lua.lua_setfield(L, -2, to_luastring(field));
            }
            lua.lua_pop(L, 1);
        }

        lua.lua_pushstring(L, to_luastring('Lua 5.1'));
        lua.lua_setglobal(L, to_luastring('_VERSION'));
        setLibrary(L, 'redis', { call: redisCall });
        setLibrary(L, 'cjson', { decode, encode });
        lua.lua_getglobal(L, to_luastring('cjson'));
        lua.lua_pushlightuserdata(L, CJSON_NULL);
        lua.lua_setfield(L, -2, to_luastring('null'));
        lua.lua_pop(L, 1);
        setStrings(L, 'KEYS', keyStrings);
        setStrings(L, 'ARGV', argStrings);

        for (const [chunk, name] of [
            [PROTECT_GLOBALS, '=protect_globals'],
            [script, '=user_script'],
        ]) {
            const source = to_luastring(chunk);

            if (
                lauxlib.luaL_loadbuffer(L, source, source.length, to_luastring(name)) !==
                    lua.LUA_OK ||
                lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK
            ) {
                fail(errorFrom(L));
            }
        }

        return replyFrom(L, -1);
    };

    return {
        /** Runs a command directly, for seeding and inspecting the store. */
        call,
        eval: evaluate,
        /** @param {string} key */
        get: async key => call('GET', key),
        /** @param {string} key */
        hGetAll: async key => {
            const flat = /** @type {string[]} */ (call('HGETALL', key));

            return Object.fromEntries(
                flat.flatMap((field, i) => (i % 2 === 0 ? [[field, flat[i + 1]]] : [])),
            );
        },
        /**
         * Seconds until `key` expires, rounded as Redis's TTL rounds them, or
         * `undefined` when it has no expiry or no longer exists.
         * @param {string} key
         */
        ttl: key => {
            const expiresAt = live(key)?.expiresAt;

            return expiresAt === undefined
                ? undefined
                : Math.round((expiresAt - Date.now()) / 1000);
        },
    };
};
