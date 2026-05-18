/**
 * Nominal-type utility for the Pipeline architecture.
 *
 * Branded types satisfy Rule #15 (no primitive returns) AND pass
 * SonarJS rule typescript:S6564 because the right-hand side is a
 * `TSIntersectionType`, not one of the keyword types in the rule's
 * trigger set. Source verification:
 * https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/S6564/rule.ts
 *
 * The shape mirrors the existing `ICursorFirstPageWire` brand in
 * `Mediator/Scrape/CursorPagination.ts` — the project already uses
 * the `__brand` field; this module formalises the pattern as a
 * reusable generic so every primitive return type can become
 * nominal in one line.
 *
 * Branded values are NOT assignable from raw primitives; callers
 * must mint a value via the matching `mint*` helper. The mint
 * helper is a zero-cost cast at runtime — the brand exists only
 * in the type system.
 */

/**
 * Brand utility — produces a nominal type from a primitive plus a
 * unique tag. The tag is a string literal that names the brand;
 * unique tags keep distinct brands non-interchangeable even when
 * they share the same primitive base.
 */
export type Brand<TBase, TTag extends string> = TBase & {
  readonly __brand: TTag;
};

/** Account identifier carried through the scrape pipeline. */
export type AccountId = Brand<string, 'AccountId'>;

/**
 * Mints an AccountId from a raw string. Use at the boundary where
 * a discovered identifier becomes the canonical pipeline value.
 * @param raw - Raw account identifier string.
 * @returns The same string typed as AccountId.
 */
export function mintAccountId(raw: string): AccountId {
  return raw as AccountId;
}

/** Bank registry identifier (CompanyId). */
export type BankId = Brand<string, 'BankId'>;

/**
 * Mints a BankId from a raw string.
 * @param raw - Raw bank identifier.
 * @returns The same string typed as BankId.
 */
export function mintBankId(raw: string): BankId {
  return raw as BankId;
}

/** Origin+pathname URL safe for logs (query string stripped). */
export type SafeUrlForLog = Brand<string, 'SafeUrlForLog'>;

/**
 * Mints a SafeUrlForLog from a string. The caller is responsible
 * for stripping the query string before minting; the mint helper
 * does NOT sanitise.
 * @param sanitised - Origin+pathname only, query and credentials
 * already removed.
 * @returns The same string typed as SafeUrlForLog.
 */
export function mintSafeUrlForLog(sanitised: string): SafeUrlForLog {
  return sanitised as SafeUrlForLog;
}

/** API envelope error code (e.g., '0', '99'). */
export type EnvelopeErrorCode = Brand<string, 'EnvelopeErrorCode'>;

/**
 * Mints an EnvelopeErrorCode from a raw string.
 * @param raw - Raw error code from an API envelope.
 * @returns The same string typed as EnvelopeErrorCode.
 */
export function mintEnvelopeErrorCode(raw: string): EnvelopeErrorCode {
  return raw as EnvelopeErrorCode;
}

/** Index into a multi-account scrape pass (zero-based). */
export type AccountIndex = Brand<number, 'AccountIndex'>;

/**
 * Mints an AccountIndex from a number.
 * @param n - Zero-based account index.
 * @returns The same number typed as AccountIndex.
 */
export function mintAccountIndex(n: number): AccountIndex {
  return n as AccountIndex;
}

/** Phase wall-clock duration in milliseconds. */
export type DurationMs = Brand<number, 'DurationMs'>;

/**
 * Mints a DurationMs from a number.
 * @param ms - Duration in milliseconds.
 * @returns The same number typed as DurationMs.
 */
export function mintDurationMs(ms: number): DurationMs {
  return ms as DurationMs;
}

/** Predicate result indicating whether a pipeline step succeeded. */
export type DidSucceed = Brand<boolean, 'DidSucceed'>;

/**
 * Mints a DidSucceed from a boolean.
 * @param flag - True when the step succeeded.
 * @returns The same boolean typed as DidSucceed.
 */
export function mintDidSucceed(flag: boolean): DidSucceed {
  return flag as DidSucceed;
}

/** Predicate result indicating whether iteration must stop. */
export type ShouldStop = Brand<boolean, 'ShouldStop'>;

/**
 * Mints a ShouldStop from a boolean.
 * @param flag - True when iteration must stop.
 * @returns The same boolean typed as ShouldStop.
 */
export function mintShouldStop(flag: boolean): ShouldStop {
  return flag as ShouldStop;
}

/** Lowercase bank slug (e.g. "pepper", "discount"). */
export type BankSlug = Brand<string, 'BankSlug'>;

/**
 * Mints a BankSlug from a raw string.
 * @param raw - Raw lowercase bank slug.
 * @returns The same string typed as BankSlug.
 */
export function mintBankSlug(raw: string): BankSlug {
  return raw as BankSlug;
}

/** Diagnostic phase-and-step descriptor used for screenshot/fixture labels. */
export type PhaseStepLabel = Brand<string, 'PhaseStepLabel'>;

/**
 * Mints a PhaseStepLabel from a raw string.
 * @param raw - Raw label like "login-pre-done".
 * @returns The same string typed as PhaseStepLabel.
 */
export function mintPhaseStepLabel(raw: string): PhaseStepLabel {
  return raw as PhaseStepLabel;
}

/**
 * Opaque frame identifier — 'main' or 'iframe:<stable-url>'. Used by
 * the FrameRegistry to look up a Playwright `Frame` from a string
 * that crosses Mediator boundaries. Mint at the FrameRegistry
 * boundary; consumers receive the brand and round-trip it.
 *
 * Re-exported from `PipelineContext.ts` to preserve existing import
 * paths — the canonical declaration lives here to avoid a cyclic
 * import between `Brand` and `PipelineContext`.
 */
export type ContextId = Brand<string, 'ContextId'>;

/**
 * Mints a ContextId from a raw string.
 * @param raw - Raw identifier built from frame URL or name.
 * @returns The same string typed as ContextId.
 */
export function mintContextId(raw: string): ContextId {
  return raw as ContextId;
}

/**
 * Canonical main-frame identifier. Exported as a const so callers
 * (FrameRegistry, DashboardPhaseActions, and any future Mediator that
 * needs to address the main frame) share a single source of truth
 * instead of repeating `mintContextId('main')` or `'main' as ContextId`
 * inline (CodeRabbit follow-up 2026-05-18).
 */
export const MAIN_CONTEXT_ID: ContextId = mintContextId('main');
