/**
 * Public API. Implementations live in `./tagged.js` and `./neverthrow.js`.
 *
 * `ok` / `err` / `Result` / `ResultAsync` are re-exported from
 * [neverthrow](https://github.com/supermacro/neverthrow) — not a rewrite.
 */

export {
  Err,
  Ok,
  Result,
  ResultAsync,
  err,
  errAsync,
  fromAsyncThrowable,
  fromPromise,
  fromSafePromise,
  fromThrowable,
  ok,
  okAsync,
  safeTry,
} from "./neverthrow.js";

export {
  defineErrors,
  findErrorOf,
  formatError,
  formatTaggedError,
  hasErrorOf,
  isErrorOf,
  isTaggedError,
  payload,
  toThrowable,
  withCause,
} from "./tagged.js";

export { remapError } from "./remap.js";

export type { AnyTaggedError, ErrorOf, Payload, WithCause } from "./tagged.js";
export type { RemapBuilder, RemapSource } from "./remap.js";
