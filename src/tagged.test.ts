import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { inspect } from "node:util";
import {
  defineErrors,
  findErrorOf,
  formatError,
  formatTaggedError,
  hasErrorOf,
  isErrorOf,
  isTaggedError,
  payload,
  remapError,
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
  assert.equal(err.data.status, 401);
  assert.equal(err.data.body, "nope");
  assert.equal(formatError(err).type, "unauthorized");
});

test("cause is a sibling of data, not nested in it", () => {
  const root = new Error("fetch failed");
  const err = EntityErr.unauthorized("expired", { status: 401, cause: root });
  assert.equal(err.cause, root);
  assert.equal(err.data.status, 401);
  assert.equal("cause" in err.data, false);
});

test("cause-only does not attach an empty data bag", () => {
  const root = new Error("fetch failed");
  const err = EntityErr.validation("bad input", { cause: root });
  assert.equal(err.cause, root);
  assert.equal("data" in err, false);
});

test("ErrorOf is narrowed with isErrorOf, not .type", () => {
  const errors: EntityError[] = [
    EntityErr.validation("x"),
    EntityErr.unauthorized("y", { status: 403 }),
  ];
  for (const e of errors) {
    if (isErrorOf(e, EntityErr.unauthorized)) {
      assert.equal(e.data.status, 403);
    } else {
      assert.equal(isErrorOf(e, EntityErr.validation), true);
      assert.equal("data" in e, false);
    }
  }
});

test("declared payload requires a data argument and a data field", () => {
  // @ts-expect-error extra fields require a data argument
  EntityErr.unauthorized("expired");
  type Unauthorized = ReturnType<typeof EntityErr.unauthorized>;
  false satisfies Extends<undefined, Unauthorized["data"]>;
  const err = EntityErr.unauthorized("expired", { status: 401 });
  assert.equal(err.data.status, 401);
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
    // Narrowed: `.data` is required — no optional chain.
    assert.equal(err.data.status, 401);
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

test("hasErrorOf is true for the error itself and false when no variant matches", () => {
  const err: EntityError = EntityErr.network("boom");
  assert.equal(hasErrorOf(err, EntityErr.network), true);
  assert.equal(hasErrorOf(err, EntityErr.unauthorized, EntityErr.network), true);
  assert.equal(hasErrorOf(err, EntityErr.validation), false);
  assert.equal(hasErrorOf("not an error", EntityErr.network), false);
  assert.equal(hasErrorOf(null, EntityErr.network), false);
});

test("hasErrorOf and findErrorOf walk the cause chain", () => {
  const inner = EntityErr.unauthorized("expired", { status: 401 });
  const outer = EntityErr.network(withCause("request failed", inner));
  assert.equal(isErrorOf(outer, EntityErr.unauthorized), false);
  assert.equal(hasErrorOf(outer, EntityErr.unauthorized), true);
  assert.equal(hasErrorOf(outer, EntityErr.validation), false);
  assert.equal(findErrorOf(outer, EntityErr.unauthorized), inner);
  assert.equal(findErrorOf(outer, EntityErr.network), outer);
  assert.equal(findErrorOf(outer, EntityErr.validation), undefined);
  const found = findErrorOf(outer, EntityErr.unauthorized);
  if (found) {
    assert.equal(found.data.status, 401);
  }
});

test("findErrorOf prefers the nearest match (self before cause)", () => {
  const inner = EntityErr.network("inner");
  const outer = EntityErr.network(withCause("outer", inner));
  assert.equal(findErrorOf(outer, EntityErr.network), outer);
});

test("hasErrorOf finds a collaborator variant after remapError", () => {
  const source = EntityErr.unauthorized("expired", { status: 401 });
  const mapped = remapError(source, {
    _: ReferenceErr.validation,
  });
  assert.equal(isErrorOf(mapped, ReferenceErr.validation), true);
  assert.equal(hasErrorOf(mapped, EntityErr.unauthorized), true);
  assert.equal(findErrorOf(mapped, EntityErr.unauthorized), source);
  const found = findErrorOf(mapped, EntityErr.unauthorized);
  if (found) {
    assert.equal(found.data.status, 401);
  }
});

test("hasErrorOf and findErrorOf walk native Error.cause and toThrowable", () => {
  const tagged = EntityErr.unauthorized("expired", { status: 401 });
  const thrown = toThrowable(EntityErr.network(withCause("request failed", tagged)));
  assert.equal(hasErrorOf(thrown, EntityErr.unauthorized), true);
  assert.equal(findErrorOf(thrown, EntityErr.unauthorized), tagged);

  const native = new Error("wrapper", { cause: tagged });
  assert.equal(hasErrorOf(native, EntityErr.unauthorized), true);
  assert.equal(findErrorOf(native, EntityErr.unauthorized), tagged);
});

test("findErrorOf walks AggregateError.errors after cause", () => {
  const nested = EntityErr.validation("bad input");
  const caused = EntityErr.unauthorized("expired", { status: 401 });
  const aggregate = Object.assign(new AggregateError([nested], "multi"), {
    cause: caused,
  });
  assert.equal(findErrorOf(aggregate, EntityErr.unauthorized), caused);
  assert.equal(findErrorOf(aggregate, EntityErr.validation), nested);
  assert.equal(hasErrorOf(aggregate, EntityErr.network), false);
});

test("hasErrorOf and findErrorOf do not loop on a cyclic cause", () => {
  const a = EntityErr.network("a");
  const b = EntityErr.validation("b");
  (a as { cause: unknown }).cause = b;
  (b as { cause: unknown }).cause = a;
  assert.equal(hasErrorOf(a, EntityErr.validation), true);
  assert.equal(findErrorOf(a, EntityErr.validation), b);
  assert.equal(findErrorOf(a, EntityErr.unauthorized), undefined);
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
  assert.equal(thrown.data.status, 401);
  assert.equal(thrown.data.body, "nope");
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

test("formatError matches a real fetch ECONNREFUSED", async () => {
  const port = await closedLocalPort();
  let fetched: unknown;
  try {
    await fetch(`http://127.0.0.1:${port}`);
    assert.fail("expected fetch to refuse the connection");
  } catch (cause) {
    fetched = cause;
  }

  assert.ok(fetched instanceof TypeError);
  assert.equal(fetched.message, "fetch failed");

  const err = EntityErr.network(withCause("Entities request failed", fetched));
  assert.deepEqual(formatError(err), {
    type: "network",
    message: "Entities request failed",
    cause: {
      name: "TypeError",
      message: "fetch failed",
      cause: formatNativeConnectCause(fetched.cause, port),
    },
  });
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

function closedLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("expected a TCP address"));
        return;
      }
      const { port } = address;
      server.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else resolve(port);
      });
    });
    server.once("error", reject);
  });
}

/** Shape `formatError` should emit for fetch's nested connect failure. */
function formatNativeConnectCause(cause: unknown, port: number): Record<string, unknown> {
  if (cause instanceof AggregateError) {
    const first = cause.errors[0] as NodeJS.ErrnoException | undefined;
    assert.equal(first?.code, "ECONNREFUSED");
    return {
      name: "AggregateError",
      message: cause.message,
      ...("code" in cause && cause.code !== undefined ? { code: cause.code } : {}),
      errors: [connectRefusedFields(first, port)],
    };
  }

  const refused = cause as NodeJS.ErrnoException;
  assert.equal(refused.code, "ECONNREFUSED");
  return connectRefusedFields(refused, port);
}

function connectRefusedFields(refused: NodeJS.ErrnoException, port: number): Record<string, unknown> {
  return {
    name: refused.name,
    message: refused.message,
    code: "ECONNREFUSED",
    errno: refused.errno,
    syscall: "connect",
    address: "127.0.0.1",
    port,
  };
}
