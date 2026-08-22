import { inspect } from "node:util";

/**
 * Tagged errors for typed domain failures.
 *
 * Define a domain's errors with `defineErrors` (one builder per variant), then
 * narrow with `isErrorOf` on the derived `ErrorOf<typeof …>` union. The kind
 * name is not a public field on the error — `formatError` still prints it.
 *
 *   const EntityErr = defineErrors({
 *     validation: payload(),                          // { message }
 *     unauthorized: payload<{ status?: number }>(),   // extra fields live on data
 *   });
 *   type EntityError = ErrorOf<typeof EntityErr>;     // the union, for free
 *
 *   EntityErr.validation("bad input");
 *   EntityErr.unauthorized("expired", { status: 401, cause });
 *   // → { message, cause, data: { status: 401 } }
 *   // `data` is required on the type whenever the variant declared extra fields.
 *
 *   EntityErr.network(withCause("Entities request failed", cause));
 *
 * Two propagation styles, one shape:
 * - **return** `err(EntityErr.validation("bad input"))` / `ok(value)` (neverthrow
 *   `Result`, re-exported from this package), or
 * - **throw** it at a job-queue / framework boundary that catches `Error`s
 *   via `throw toThrowable(err)`, then narrow in the catch with `isTaggedError`.
 *
 * Matching is by builder identity: `EntityErr.network` and `ReferenceErr.network`
 * do not collide, and TypeScript rejects passing a builder from another factory.
 *
 *   if (isErrorOf(err, EntityErr.upstream)) { err.data.status }
 *   if (isErrorOf(err, EntityErr.upstream, EntityErr.network)) { ... }
 *
 *   hasErrorOf(err, EntityErr.upstream)           // this error or any cause
 *   findErrorOf(err, EntityErr.upstream)?.data.status
 */

/**
 * Brand marking an object as one of our tagged errors. Enumerable symbol keys
 * are copied by `Object.assign`/spread (so they survive `toThrowable`) yet are
 * invisible to `JSON.stringify` and `Object.keys`.
 */
const TAGGED_ERROR = Symbol.for("xerrors.taggedError");
/** Per-builder identity; value is a unique symbol minted in `defineErrors`. */
const ERROR_VARIANT = Symbol.for("xerrors.errorVariant");

function variantId(value: object): unknown {
  return (value as Record<symbol, unknown>)[ERROR_VARIANT];
}

function captureStack(): string | undefined {
  const err = new Error();
  return err.stack;
}

/** Phantom carrier that pins the extra data type for one variant. */
export type Payload<TData> = { readonly __data?: TData };

export function payload<TData = Record<never, never>>(): Payload<TData> {
  return {};
}

type DataOf<P> = P extends Payload<infer T> ? T : Record<never, never>;

/** Caller message + thrown value, for `DomainErr.network(withCause(message, cause))`. */
export type WithCause = {
  message: string;
  cause: unknown;
};

/**
 * Pair a caller message with a thrown value for a `defineErrors` builder.
 *
 *   EntityErr.network(withCause("Entities request failed", cause));
 */
export function withCause(message: string, cause: unknown): WithCause {
  return { message, cause };
}

type TaggedErrorBase = {
  message: string;
  stack?: string;
  cause?: unknown;
};

/**
 * Phantom factory identity. `Invariant` keeps the brand from being assignable
 * when one spec is a structural subset of the other (Entity vs Reference).
 * Type-only: runtime error objects do not carry this field.
 */
type Invariant<T> = (value: T) => T;
type FactoryBranded<TSpec> = { readonly "~factory": Invariant<TSpec> };
/** Keeps same-shape variants (e.g. `validation` vs `network`) distinct without a public `.type`. */
type VariantBranded<TType extends string> = { readonly "~variant": Invariant<TType> };

/** Extra fields, omitted at runtime when the variant declares none. */
type TaggedError<TType extends string, TData, TSpec> = ([keyof TData] extends [never]
  ? TaggedErrorBase & { data?: never }
  : TaggedErrorBase & { data: TData }) &
  FactoryBranded<TSpec> &
  VariantBranded<TType>;

/** Data arg is required when the variant declares extra fields (even if optional). */
type ErrorBuilder<TType extends string, TData, TSpec> = ([keyof TData] extends [never]
  ? (
      message: string | WithCause,
      data?: TData & { cause?: unknown },
    ) => TaggedError<TType, TData, TSpec>
  : (
      message: string | WithCause,
      data: TData & { cause?: unknown },
    ) => TaggedError<TType, TData, TSpec>) & {
  /** The variant tag, so the builder itself can be used with `isErrorOf`. */
  type: TType;
};

type ErrorFactory<TSpec extends Record<string, Payload<unknown>>> = {
  [K in keyof TSpec & string]: ErrorBuilder<K, DataOf<TSpec[K]>, TSpec>;
};

export function defineErrors<TSpec extends { [K in keyof TSpec]: Payload<unknown> }>(
  spec: TSpec,
): ErrorFactory<TSpec> {
  const factory: Record<string, unknown> = {};
  for (const type of Object.keys(spec)) {
    const id = Symbol(type);
    const build = (messageOrCause: string | WithCause, data?: Record<string, unknown>) => {
      const caused = typeof messageOrCause === "string" ? undefined : messageOrCause;
      const message = caused ? caused.message : messageOrCause;
      const { cause: dataCause, ...rest } = data ?? {};
      const cause = dataCause !== undefined ? dataCause : caused?.cause;
      // Cause-only (`{ cause }`) does not mint an empty data bag. `{}` does,
      // so a variant that declared extra fields always has `.data` at runtime.
      const attachData =
        data !== undefined && (Object.keys(rest).length > 0 || !("cause" in data));
      return {
        [TAGGED_ERROR]: true,
        [ERROR_VARIANT]: id,
        type,
        message,
        stack: captureStack(),
        ...(cause !== undefined ? { cause } : {}),
        ...(attachData ? { data: rest } : {}),
      };
    };
    factory[type] = Object.assign(build, { type, [ERROR_VARIANT]: id });
  }
  return factory as ErrorFactory<TSpec>;
}

/** The error union produced by a `defineErrors` factory. */
export type ErrorOf<TFactory extends Record<string, (...args: never[]) => unknown>> = ReturnType<
  TFactory[keyof TFactory]
>;

/** Minimal shape shared by every tagged error, regardless of domain. */
export type AnyTaggedError = {
  message: string;
  stack?: string;
  cause?: unknown;
  /** Set when a `defineErrors` variant declared extra fields; omitted when empty. */
  data?: unknown;
};

/** Runtime kind name, for formatters and `remapError`. Not part of the public error type. */
export function errorType(err: AnyTaggedError): string {
  return (err as AnyTaggedError & { type: string }).type;
}

/** True for objects minted by a `defineErrors` builder (survives `toThrowable`). */
export function isTaggedError(value: unknown): value is AnyTaggedError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[TAGGED_ERROR] === true
  );
}

type ErrorVariant = (...args: never[]) => AnyTaggedError;

/** Factory spec stamped on a tagged error; `never` when the value is unbranded. */
type SpecOf<T> = T extends FactoryBranded<infer S> ? Invariant<S> : never;

/**
 * Same `defineErrors` call as `error`. Unbranded `AnyTaggedError` (e.g. after
 * `isTaggedError`) accepts any builder; runtime identity still decides.
 */
type SameFactory<E, V extends ErrorVariant> = [SpecOf<E>] extends [never]
  ? V
  : [SpecOf<ReturnType<V>>] extends [SpecOf<E>]
    ? V
    : never;

/**
 * Narrow a tagged-error union to one or more variants, passing the
 * `defineErrors` builder(s) themselves.
 * Identity is the builder that minted the error, not the `.type` string, so
 * same-named variants from different factories do not match — TypeScript
 * rejects a builder from another factory when `error` is a domain union.
 *
 *   if (isErrorOf(err, EntityErr.upstream)) {
 *     err.data.status // narrowed to the `upstream` variant's data
 *   }
 *
 *   if (isErrorOf(err, EntityErr.upstream, EntityErr.network)) { ... } // OR check
 */
export function isErrorOf<E extends AnyTaggedError, const B extends readonly ErrorVariant[]>(
  error: E,
  ...variants: { [I in keyof B]: SameFactory<E, B[I]> }
): error is Extract<E, ReturnType<B[number]>> {
  return matchesAnyVariant(error, variants);
}

function matchesAnyVariant(error: object, variants: readonly ErrorVariant[]): boolean {
  const id = variantId(error);
  return variants.some((variant) => variantId(variant) === id);
}

/**
 * Walk `error`, then `cause`, then `AggregateError.errors`. Yields each
 * object once (cycle-safe). Used by `hasErrorOf` / `findErrorOf`.
 */
function* walkErrorTree(root: unknown): Generator<object> {
  const seen = new WeakSet<object>();
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || current === undefined || typeof current !== "object") {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    yield current;

    const record = current as { cause?: unknown; errors?: unknown };
    // LIFO: push siblings first so `cause` is visited next (self → cause chain
    // → AggregateError.errors).
    if (Array.isArray(record.errors)) {
      for (let i = record.errors.length - 1; i >= 0; i--) {
        stack.push(record.errors[i]);
      }
    }
    if (record.cause !== undefined && record.cause !== null) {
      stack.push(record.cause);
    }
  }
}

/**
 * True if `error` or any value in its cause chain matches one of the
 * builders. Unlike `isErrorOf`, this is not a type guard on `error` — a
 * match may be nested under `cause` — and builders from other factories
 * are allowed so a remapped error can still be searched for the original.
 *
 *   hasErrorOf(failure, EntityErr.unauthorized)
 *   hasErrorOf(processError, CaptureErr.not_found)
 */
export function hasErrorOf<const B extends readonly ErrorVariant[]>(
  error: unknown,
  ...variants: B
): boolean {
  return findErrorOf(error, ...variants) !== undefined;
}

/**
 * First tagged error in `error` and its cause chain that matches one of
 * the builders, or `undefined`. Visit order: the value itself, then
 * `cause`, then `AggregateError.errors`. Matching is by builder identity.
 *
 *   const unauthorized = findErrorOf(failure, EntityErr.unauthorized);
 *   unauthorized?.data.status
 */
export function findErrorOf<const B extends readonly ErrorVariant[]>(
  error: unknown,
  ...variants: B
): ReturnType<B[number]> | undefined {
  for (const current of walkErrorTree(error)) {
    if (isTaggedError(current) && matchesAnyVariant(current, variants)) {
      return current as ReturnType<B[number]>;
    }
  }
  return undefined;
}

/**
 * Wrap a tagged error in a real `Error` for throwing at a job-queue /
 * framework boundary that catches thrown `Error`s. The `Error` owns the
 * throw-site `stack` and native `cause`; `data` and the brand ride along
 * (and the runtime kind, so `formatError` still prints `type`). Narrow in
 * the catch with `isTaggedError` + `isErrorOf`.
 */
export function toThrowable<E extends AnyTaggedError>(tagged: E): Error & E {
  // Drop the factory-captured stack so the Error's throw-site stack wins.
  const { stack: _stack, ...rest } = tagged;
  const error = new Error(
    tagged.message,
    tagged.cause !== undefined ? { cause: tagged.cause } : undefined,
  );
  return Object.assign(error, rest) as Error & E;
}

const NATIVE_ERROR_DETAIL_KEYS = [
  "code",
  "errno",
  "syscall",
  "address",
  "port",
  "path",
  "dest",
] as const;

function formatNativeError(err: Error): Record<string, unknown> {
  const formatted: Record<string, unknown> = {
    name: err.name,
    message: err.message,
  };
  const record = err as unknown as Record<string, unknown>;
  for (const key of NATIVE_ERROR_DETAIL_KEYS) {
    if (record[key] !== undefined) {
      formatted[key] = record[key];
    }
  }
  if (Array.isArray(record.errors)) {
    formatted.errors = record.errors.map(formatErrorValue);
  } else if (err instanceof AggregateError) {
    formatted.errors = err.errors.map(formatErrorValue);
  }
  if (err.cause !== undefined && err.cause !== null) {
    formatted.cause = formatErrorValue(err.cause);
  }
  return formatted;
}

function formatData(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  if (Object.keys(data).length === 0) {
    return undefined;
  }
  return `data: ${JSON.stringify(data)}`;
}

function formatErrorValue(err: unknown): Record<string, unknown> {
  if (isTaggedError(err)) {
    const formatted: Record<string, unknown> = { type: errorType(err), message: err.message };
    if (err.cause !== undefined && err.cause !== null) {
      formatted.cause = formatErrorValue(err.cause);
    }
    if (err.data !== undefined) {
      formatted.data = err.data;
    }
    return formatted;
  }
  if (err instanceof Error) {
    return formatNativeError(err);
  }
  return { message: String(err) };
}

function attachFullInspect(value: Record<string, unknown>): Record<string, unknown> {
  Object.defineProperty(value, inspect.custom, {
    enumerable: false,
    configurable: true,
    value(_depth: unknown, options: { colors?: boolean }) {
      return inspect(value, {
        colors: options.colors,
        compact: false,
        customInspect: false,
        depth: Infinity,
      });
    },
  });
  return value;
}

/**
 * Compact log payload: type, message, cause, and data. Native errors also
 * include name and Node detail fields (code, syscall, …). No stack.
 *
 * `console.error` uses `util.inspect` with depth 2, which would collapse this
 * chain. A custom inspect expands the whole object.
 */
export function formatError(err: unknown): Record<string, unknown> {
  return attachFullInspect(formatErrorValue(err));
}

/**
 * Multi-line detail string for logs or persisted failure text: message, then
 * data, then stack, then the cause chain.
 */
export function formatTaggedError(err: unknown): string {
  if (!isTaggedError(err)) {
    if (err instanceof Error) {
      const parts = [err.message];
      if (err.stack) {
        parts.push("", err.stack);
      }
      return parts.join("\n");
    }
    return String(err);
  }

  const parts = [err.message, `type: ${errorType(err)}`];
  const dataLine = formatData(err.data);
  if (dataLine) {
    parts.push(dataLine);
  }
  if (err.stack) {
    parts.push("", err.stack);
  }
  if (err.cause !== undefined && err.cause !== null) {
    parts.push("", "Caused by:", formatTaggedError(err.cause));
  }
  return parts.join("\n");
}
