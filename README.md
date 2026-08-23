# ts-xerrorof

Tagged domain errors for TypeScript. Define a factory per domain, get a typed union for free, and propagate the same shape whether you return it or throw it.

Requires [Node.js](https://nodejs.org/) (the log formatter uses `util.inspect`).

## Install

```bash
pnpm add ts-xerrorof
```

## Result (`ok` / `err`)

`ok`, `err`, `Result`, `ResultAsync`, and the other Result helpers are **re-exported from [neverthrow](https://github.com/supermacro/neverthrow)** — not a rewrite. They are the same functions and types:

```ts
import { ok, err, type Result } from "ts-xerrorof";
import { ok as neverthrowOk } from "neverthrow";

ok === neverthrowOk; // true
```

Re-exported primitives: `ok`, `err`, `Ok`, `Err`, `Result`, `okAsync`, `errAsync`, `ResultAsync`, `fromThrowable`, `fromAsyncThrowable`, `fromPromise`, `fromSafePromise`, `safeTry`.

Use them with tagged errors:

```ts
import { defineErrors, err, ok, payload, type ErrorOf, type Result } from "ts-xerrorof";

function save(entity: Entity | null): Result<Entity, EntityError> {
  if (entity === null) {
    return err(EntityErr.validation("bad input"));
  }
  return ok(entity);
}
```

See the [neverthrow docs](https://github.com/supermacro/neverthrow) for `Result` / `ResultAsync` methods (`isOk`, `isErr`, `fromPromise`, …).

## Define a domain

```ts
import { defineErrors, payload, type ErrorOf } from "ts-xerrorof";

const EntityErr = defineErrors({
  validation: payload(), // { message }
  unauthorized: payload<{ status?: number }>(), // extra fields live on data
  network: payload(),
});

type EntityError = ErrorOf<typeof EntityErr>;

EntityErr.validation("bad input");
EntityErr.unauthorized("expired"); // data: {}
EntityErr.unauthorized("expired", { status: 401, cause });
// → { message, cause, data: { status: 401 } }
```

`ErrorOf<typeof EntityErr>` is the union of every variant. Narrow with `isErrorOf` — there is no public `.type` field on the error. `formatError` still includes the kind name in logs.

## Attach a cause

Keep the caller message and attach the original failure as `cause`:

```ts
import { withCause } from "ts-xerrorof";

EntityErr.network(withCause("Entities request failed", cause));
```

Do not promote `cause.message` to the tagged `message`.

## Narrow by builder identity

Each builder doubles as a variant tag. Matching is by the factory that minted the error, not the `.type` string, so `EntityErr.network` and `ReferenceErr.network` do not collide.

```ts
import { isErrorOf } from "ts-xerrorof";

if (isErrorOf(failure, EntityErr.unauthorized)) {
  failure.data.status; // `data` is required; `status` is optional on this payload
}

if (isErrorOf(failure, EntityErr.unauthorized, EntityErr.network)) {
  // OR check
}
```

`isTaggedError` is the unbranded guard (useful after a catch). Unbranded values accept any builder; runtime identity still decides.

`isErrorOf` only checks the error you pass. After `withCause` or `remapError`, the original lives on `cause`. `hasErrorOf` / `findErrorOf` walk that chain (including native `Error.cause` and `AggregateError.errors`). Matching is still by builder identity, so a remapped error can be searched for the collaborator variant.

```ts
import { findErrorOf, hasErrorOf } from "ts-xerrorof";

hasErrorOf(failure, EntityErr.unauthorized);

const unauthorized = findErrorOf(failure, EntityErr.unauthorized);
if (unauthorized) {
  unauthorized.data.status; // `data` is required after a match
}

hasErrorOf(processError, CaptureErr.not_found);
```

## Remap across domains

`isErrorOf` will not treat `CaptureErr.not_found` as `ProcessErr.not_found`. When a layer should translate *kind by name*, use `remapError`. `_` is the fallback. Message is kept; the original is `cause`.

```ts
import { remapError } from "ts-xerrorof";

return err(
  remapError(captureError, {
    not_found: ProcessErr.not_found,
    validation: ProcessErr.validation,
    _: ProcessErr.db,
  }),
);
```

Builders that require extra `data` fields are not assignable — map those by hand so you can pass `status` / `body`.

## Return or throw

One tagged-error shape, two ways to propagate:

- **Return** `err(EntityErr.validation("bad input"))` / `ok(value)` from services (`Result` from neverthrow).
- **Throw** at a job-queue / framework boundary that catches `Error`s:

```ts
import { isTaggedError, toThrowable } from "ts-xerrorof";

throw toThrowable(failure);

try {
  await run();
} catch (caught) {
  if (isTaggedError(caught) && isErrorOf(caught, EntityErr.network)) {
    // ...
  }
}
```

`toThrowable` wraps the tag in a real `Error` (throw-site stack, native `cause`) and copies `data` and the brand so the catch can still narrow with `isErrorOf`.

## Format for logs

```ts
import { formatError, formatTaggedError } from "ts-xerrorof";

console.error("upstream failed", formatError(failure));
// compact object: type, message, cause, data — no stack.
// Native errors also include name and Node detail fields (code, syscall, …).

formatTaggedError(failure);
// multi-line detail: message, type, data, stack, then the cause chain
```

`formatError` attaches a custom `util.inspect` so `console.error` (inspect depth 2) does not collapse nested causes.

## License

[MIT](./LICENSE)
