/**
 * Result primitives from [neverthrow](https://github.com/supermacro/neverthrow).
 *
 * These are re-exports, not a rewrite. `ok`, `err`, `Result`, `ResultAsync`,
 * and the rest are the same values and types as importing neverthrow directly.
 *
 *   import { ok, err, type Result } from "xerrors";
 *   import { ok as neverthrowOk } from "neverthrow";
 *   ok === neverthrowOk // true
 *
 * Combine with tagged errors:
 *
 *   return err(EntityErr.validation("bad input"));
 *   return ok(entity);
 *
 * @see https://github.com/supermacro/neverthrow
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
} from "neverthrow";
