import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import {
  defineErrors,
  formatError,
  formatTaggedError,
  isErrorOf,
  isTaggedError,
  payload,
  toThrowable,
  withCause,
  type AnyTaggedError,
  type ErrorOf,
} from "./index.js";

const EntityErr = defineErrors({
  validation: payload(),
  unauthorized: payload<{ status?: number; body?: string }>(),
  network: payload(),
});
type EntityError = ErrorOf<typeof EntityErr>;

const ReferenceErr = defineErrors({
  network: payload(),
  validation: payload(),
});
type ReferenceError = ErrorOf<typeof ReferenceErr>;

type Extends<A, B> = [A] extends [B] ? true : false;

test("builder stamps message and captures stack", () => {
  const err = EntityErr.validation("bad input");
  assert.equal(err.message, "bad input");
  assert.ok(err.stack);
  assert.equal("data" in err, false);
  assert.equal(isErrorOf(err, EntityErr.validation), true);
  assert.equal(formatError(err).type, "validation");
});

test("variant carries its declared typed fields on data", () => {
  const err = EntityErr.unauthorized("expired", { status: 401, body: "nope" });
  assert.equal(isErrorOf(err, EntityErr.unauthorized), true);
  assert.equal(err.data?.status, 401);
  assert.equal(err.data?.body, "nope");
  assert.equal(formatError(err).type, "unauthorized");
});

test("cause is a sibling of data, not nested in it", () => {
  const root = new Error("fetch failed");
  const err = EntityErr.unauthorized("expired", { status: 401, cause: root });
  assert.equal(err.cause, root);
  assert.equal(err.data?.status, 401);
  assert.equal(err.data !== undefined && "cause" in err.data, false);
});

test("cause-only does not attach an empty data bag", () => {
  const root = new Error("fetch failed");
  const err = EntityErr.validation("bad input", { cause: root });
  assert.equal(err.cause, root);
  assert.equal("data" in err, false);
});

test("ErrorOf is narrowed with isErrorOf, not .type", () => {
  const errors: EntityError[] = [EntityErr.validation("x"), EntityErr.unauthorized("y")];
  for (const e of errors) {
    if (isErrorOf(e, EntityErr.unauthorized)) {
      assert.equal(e.data?.status, undefined);
    } else {
      assert.equal(isErrorOf(e, EntityErr.validation), true);
      assert.equal("data" in e, false);
    }
  }
});

test("type is not a public field on tagged errors", () => {
  const err = EntityErr.validation("bad input");
  // @ts-expect-error .type is not public — use isErrorOf or formatError
  void err.type;
  assert.equal(EntityErr.validation.type, "validation");
  assert.equal(formatError(err).type, "validation");
});

test("isErrorOf narrows to a single variant", () => {
  const err: EntityError = EntityErr.unauthorized("expired", { status: 401 });
  assert.equal(isErrorOf(err, EntityErr.unauthorized), true);
  assert.equal(isErrorOf(err, EntityErr.validation), false);
  if (isErrorOf(err, EntityErr.unauthorized)) {
    // Narrowed: `.data` is accessible without a cast.
    assert.equal(err.data?.status, 401);
  }
});

test("isErrorOf accepts multiple variants as an OR check", () => {
  const err: EntityError = EntityErr.network("boom");
  assert.equal(isErrorOf(err, EntityErr.unauthorized, EntityErr.network), true);
  assert.equal(isErrorOf(err, EntityErr.unauthorized, EntityErr.validation), false);
});

test("isErrorOf does not match same-named variants from another factory", () => {
  const entityNetwork: EntityError = EntityErr.network("boom");
  const referenceNetwork: ReferenceError = ReferenceErr.network("boom");
  assert.equal(isErrorOf(entityNetwork, EntityErr.network), true);
  assert.equal(isErrorOf(referenceNetwork, ReferenceErr.network), true);
  assert.equal(isErrorOf(entityNetwork as AnyTaggedError, ReferenceErr.network), false);
  assert.equal(isErrorOf(referenceNetwork as AnyTaggedError, EntityErr.network), false);
});

test("isErrorOf is a type error for builders from another factory", () => {
  true satisfies Extends<ReturnType<typeof EntityErr.network>, EntityError>;
  false satisfies Extends<ReturnType<typeof ReferenceErr.network>, EntityError>;
  false satisfies Extends<ReturnType<typeof EntityErr.network>, ReferenceError>;

  const entityNetwork: EntityError = EntityErr.network("boom");
  const referenceNetwork: ReferenceError = ReferenceErr.network("boom");
  // @ts-expect-error ReferenceErr.network does not mint EntityError
  isErrorOf(entityNetwork, ReferenceErr.network);
  // @ts-expect-error EntityErr.network does not mint ReferenceError
  isErrorOf(referenceNetwork, EntityErr.network);
});

test("isErrorOf still distinguishes identical-spec factories at runtime", () => {
  const LeftErr = defineErrors({ network: payload() });
  const RightErr = defineErrors({ network: payload() });
  const err = LeftErr.network("boom");
  assert.equal(isErrorOf(err, LeftErr.network), true);
  assert.equal(isErrorOf(err, RightErr.network), false);
});

test("toThrowable copies nested data, the brand, and variant identity", () => {
  const tagged = EntityErr.unauthorized("expired", { status: 401, body: "nope" });
  const thrown = toThrowable(tagged);
  assert.ok(thrown instanceof Error);
  assert.equal(thrown.message, "expired");
  assert.equal(thrown.data?.status, 401);
  assert.equal(thrown.data?.body, "nope");
  assert.ok(isTaggedError(thrown));
  assert.equal(isErrorOf(thrown, EntityErr.unauthorized), true);
  assert.equal(isErrorOf(thrown, EntityErr.network), false);
  assert.equal(formatError(thrown).type, "unauthorized");
});

test("formatTaggedError dumps data as a blob and skips empty data", () => {
  const withData = EntityErr.unauthorized("expired", { status: 401, body: "nope" });
  const formatted = formatTaggedError(withData);
  assert.match(formatted, /^expired\n/);
  assert.match(formatted, /type: unauthorized/);
  assert.match(formatted, /data: \{"status":401,"body":"nope"\}/);

  const empty = EntityErr.validation("bad input");
  const emptyFormatted = formatTaggedError(empty);
  assert.match(emptyFormatted, /type: validation/);
  assert.equal(emptyFormatted.includes("\ndata:"), false);
});

test("formatError returns type, message, data, and cause without a stack", () => {
  const root = new Error("fetch failed");
  const err = EntityErr.unauthorized("expired", { status: 401, body: "nope", cause: root });
  assert.deepEqual(formatError(err), {
    type: "unauthorized",
    message: "expired",
    cause: { name: "Error", message: "fetch failed" },
    data: { status: 401, body: "nope" },
  });
  assert.equal("stack" in formatError(err), false);

  const empty = EntityErr.validation("bad input");
  assert.deepEqual(formatError(empty), { type: "validation", message: "bad input" });
});

test("withCause keeps the caller message and attaches cause", () => {
  const cause = new TypeError("fetch failed");
  const err = EntityErr.validation(withCause("Entities request failed", cause));
  assert.equal(isErrorOf(err, EntityErr.validation), true);
  assert.equal(err.message, "Entities request failed");
  assert.equal(err.cause, cause);
});

test("formatError includes TypeError name and nested Node system details", () => {
  const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
    code: "ECONNREFUSED",
    syscall: "connect",
    address: "127.0.0.1",
    port: 443,
  });
  const typeError = new TypeError("fetch failed", { cause: inner });
  const err = EntityErr.validation(withCause("Entities request failed", typeError));
  assert.deepEqual(formatError(err), {
    type: "validation",
    message: "Entities request failed",
    cause: {
      name: "TypeError",
      message: "fetch failed",
      cause: {
        name: "Error",
        message: "connect ECONNREFUSED 127.0.0.1:443",
        code: "ECONNREFUSED",
        syscall: "connect",
        address: "127.0.0.1",
        port: 443,
      },
    },
  });
});

test("formatError expands AggregateError nested errors", () => {
  const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
    code: "ECONNREFUSED",
    syscall: "connect",
    address: "127.0.0.1",
    port: 443,
  });
  const aggregate = Object.assign(new AggregateError([inner], ""), {
    code: "ECONNREFUSED",
  });
  const typeError = new TypeError("fetch failed", { cause: aggregate });
  const err = EntityErr.validation(withCause("References request failed", typeError));
  assert.deepEqual(formatError(err), {
    type: "validation",
    message: "References request failed",
    cause: {
      name: "TypeError",
      message: "fetch failed",
      cause: {
        name: "AggregateError",
        message: "",
        code: "ECONNREFUSED",
        errors: [
          {
            name: "Error",
            message: "connect ECONNREFUSED 127.0.0.1:443",
            code: "ECONNREFUSED",
            syscall: "connect",
            address: "127.0.0.1",
            port: 443,
          },
        ],
      },
    },
  });
  const text = inspect(formatError(err), { depth: 2 });
  assert.match(text, /syscall: 'connect'/);
  assert.match(text, /address: '127\.0\.0\.1'/);
});
