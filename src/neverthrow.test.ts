import assert from "node:assert/strict";
import test from "node:test";
import {
  ResultAsync as NeverthrowResultAsync,
  err as neverthrowErr,
  ok as neverthrowOk,
} from "neverthrow";
import {
  Result,
  ResultAsync,
  defineErrors,
  err,
  isErrorOf,
  ok,
  payload,
  type ErrorOf,
  type Result as ResultType,
} from "./index.js";

const EntityErr = defineErrors({
  validation: payload(),
});
type EntityError = ErrorOf<typeof EntityErr>;

test("ok and err are neverthrow re-exports, not a rewrite", () => {
  assert.equal(ok, neverthrowOk);
  assert.equal(err, neverthrowErr);
  assert.equal(ResultAsync, NeverthrowResultAsync);
});

test("err wraps a tagged error in a neverthrow Result", () => {
  const tagged = EntityErr.validation("bad input");
  const result: ResultType<never, EntityError> = err(tagged);
  assert.equal(result.isErr(), true);
  if (result.isErr()) {
    assert.equal(result.error, tagged);
    assert.equal(isErrorOf(result.error, EntityErr.validation), true);
  }
});

test("ok wraps a success value in a neverthrow Result", () => {
  const result: ResultType<{ id: string }, EntityError> = ok({ id: "e1" });
  assert.equal(result.isOk(), true);
  if (result.isOk()) {
    assert.equal(result.value.id, "e1");
  }
});

test("Result.fromThrowable is the neverthrow helper", () => {
  const parse = Result.fromThrowable(JSON.parse, (cause) =>
    EntityErr.validation("invalid json", { cause }),
  );
  const failed = parse("{");
  assert.equal(failed.isErr(), true);
  if (failed.isErr()) {
    assert.equal(isErrorOf(failed.error, EntityErr.validation), true);
  }
});
