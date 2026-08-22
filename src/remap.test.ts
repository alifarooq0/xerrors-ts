import assert from "node:assert/strict";
import test from "node:test";
import { remapError } from "./remap.js";
import { defineErrors, isErrorOf, payload, type AnyTaggedError } from "./tagged.js";

const CaptureErr = defineErrors({
  not_found: payload(),
  validation: payload(),
  storage: payload(),
  db: payload(),
});

const ProcessErr = defineErrors({
  not_found: payload(),
  validation: payload(),
  storage: payload(),
  db: payload(),
});

const StrictErr = defineErrors({
  unauthorized: payload<{ status: number }>(),
  db: payload(),
});

function remapCapture(error: AnyTaggedError) {
  return remapError(error, {
    not_found: ProcessErr.not_found,
    validation: ProcessErr.validation,
    storage: ProcessErr.storage,
    _: ProcessErr.db,
  });
}

test("remapError maps a matching kind onto the destination builder", () => {
  const source = CaptureErr.not_found("session gone");
  const mapped = remapCapture(source);
  assert.equal(mapped.message, "session gone");
  assert.equal(isErrorOf(mapped, ProcessErr.not_found), true);
  assert.equal(isErrorOf(mapped, CaptureErr.not_found), false);
});

test("remapError uses _ for an unmapped kind", () => {
  const source = CaptureErr.db("connection refused");
  const mapped = remapCapture(source);
  assert.equal(mapped.message, "connection refused");
  assert.equal(isErrorOf(mapped, ProcessErr.db), true);
});

test("remapError attaches the original as cause, not data", () => {
  const source = CaptureErr.validation("bad input");
  const mapped = remapCapture(source);
  assert.equal(mapped.cause, source);
  assert.equal("data" in mapped, false);
});

test("remapError accepts a hand-rolled { type, message }", () => {
  const source = { type: "not_found", message: "missing object" };
  const mapped = remapError(source, {
    not_found: ProcessErr.not_found,
    _: ProcessErr.db,
  });
  assert.equal(isErrorOf(mapped, ProcessErr.not_found), true);
  assert.equal(mapped.cause, source);
});

test("remapError table: known kinds vs fallback", () => {
  const rows = [
    ["not_found", ProcessErr.not_found],
    ["validation", ProcessErr.validation],
    ["storage", ProcessErr.storage],
    ["db", ProcessErr.db],
  ] as const;
  for (const [type, dest] of rows) {
    const source = CaptureErr[type]("x");
    const mapped = remapCapture(source);
    assert.equal(isErrorOf(mapped, dest), true, type);
  }
});

test("remapError rejects builders that require extra data", () => {
  const source = CaptureErr.not_found("gone");
  remapError(source, {
    // @ts-expect-error unauthorized requires { status: number }
    not_found: StrictErr.unauthorized,
    _: ProcessErr.db,
  });
});
