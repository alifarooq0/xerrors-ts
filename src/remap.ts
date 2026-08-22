import { errorType, isTaggedError, type AnyTaggedError } from "./tagged.js";

/**
 * A `defineErrors` builder whose extra `data` is optional, so `remapError`
 * can call it with only `{ cause }`. Variants that require data fields are
 * not assignable — map those by hand.
 */
export type RemapBuilder = (
  message: string,
  data?: { cause?: unknown },
) => AnyTaggedError;

/**
 * Hand-rolled remap input. Tagged errors are also accepted; their kind is
 * read internally (not as a public `.type` field).
 *
 * Matching is by the kind *string*, not builder identity — that is the
 * point of crossing from one `defineErrors` factory to another.
 */
export type RemapSource = {
  type: string;
  message: string;
};

function remapKind(error: AnyTaggedError | RemapSource): string {
  if (isTaggedError(error)) {
    return errorType(error);
  }
  return error.type;
}

/**
 * Map a collaborator error onto this domain's builders by kind name.
 *
 * `isErrorOf` matches builder identity, so `CaptureErr.not_found` is not
 * `ProcessErr.not_found`. Remap when you *want* same-kind-by-name:
 *
 *   remapError(captureError, {
 *     not_found: ProcessErr.not_found,
 *     validation: ProcessErr.validation,
 *     _: ProcessErr.db,
 *   });
 *
 * `_` is the fallback for unmapped types. Message is preserved; the original
 * error is attached as `cause`.
 */
export function remapError<
  const M extends { readonly _: RemapBuilder } & Record<string, RemapBuilder | undefined>,
>(
  error: AnyTaggedError | RemapSource,
  map: M,
): ReturnType<Exclude<M[keyof M], undefined>> {
  const mapped = map[remapKind(error)];
  const builder = mapped !== undefined ? mapped : map._;
  return builder(error.message, { cause: error }) as ReturnType<Exclude<M[keyof M], undefined>>;
}
