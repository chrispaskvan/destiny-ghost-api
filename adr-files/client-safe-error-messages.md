# Client-Safe Error Messages

## Status

Accepted.

## Context

The fallback branch of the global error handler returned any unhandled error's `message` straight to the client. `DestinyError` and `ResponseError` had dedicated branches with curated fields, but every other `throw` — ours and our dependencies' — had its message forwarded verbatim.

That leaked. A guard added to `AuthenticationService` threw `Cannot refresh the Bungie token: the stored record has no refresh_token.`, which reached clients as-is and disclosed an internal storage concept and a field name. The fix at the time was to reword that one throw, which left the underlying pattern intact: other throw sites still carry detail no client should see, such as `more than 1 document found for emailAddress ${emailAddress}` and `Error(JSON.stringify(err.issues))` from Zod validation failures.

Three options were considered:

1. **Sanitize unconditionally.** Always return a fixed message from the fallback branch. Safest, but it silences errors that legitimately speak to clients — notably body-parser's malformed-JSON message, which is the only useful thing a caller can act on for a 400.
2. **Opt in.** Forward `message` only when the error is explicitly marked client-safe.
3. **Audit only.** Sweep the throw sites and document the constraint. Cheapest, but the exposure returns with the next new `throw`.

Option 3 keeps correctness dependent on every author remembering an undocumented rule — the exact failure that produced the leak.

## Decision

Option 2, using the `expose` property that `http-errors` already defines: the fallback branch returns `err.message` only when `err.expose === true`, and otherwise the reason phrase for the response status. The real message always reaches the log.

`expose` was chosen over a bespoke marker because body-parser (via `express.json()`) already throws `http-errors` objects that set it — `true` for 4xx, `false` for 5xx. Honoring it means the useful parse messages keep working with no per-error annotation, while library 5xx detail goes private automatically.

The handler moved out of the `loaders.init` closure into `loaders/error.middleware.js` so the behavior is unit testable, and the rule is stated in a JSDoc block on the middleware itself.

The same change validates `err.statusCode`. It previously selected the response status unchecked; it is now honored only when it is a recognized `StatusCodes` value of 400 or above, and otherwise falls back to 500. Membership in that set is also what guarantees `getReasonPhrase` resolves, since it throws for codes outside its map.

The two in-repo errors that deliberately carry a `statusCode` — `Session store unavailable.` and `Bungie API circuit breaker is open.`, both 503 — are **not** marked `expose`. Each names an internal component, and `Service Unavailable` tells a client everything it can act on. Their status codes are still honored.

## Consequences

A `throw` may now say whatever is useful for debugging; the message is a log detail, not a response field. Sending something to the client is a deliberate act that requires setting `expose = true`.

Existing throw-site messages were left alone. They are log-only now, which is where that detail belongs — rewriting them for their own sake would be churn.

Clients that were parsing internal messages out of 500 responses will see the reason phrase instead. Nothing in the repo did, and no test asserted the previous shape.

## References

* [Global error handler returns any unhandled error's message verbatim to clients](https://github.com/chrispaskvan/destiny-ghost-api/issues/674)
* [`http-errors` — `err.expose`](https://github.com/jshttp/http-errors#errorexpose)
* [OWASP — Improper Error Handling](https://owasp.org/www-community/Improper_Error_Handling)
