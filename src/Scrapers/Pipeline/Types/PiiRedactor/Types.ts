/**
 * PiiRedactor — shared types and constants.
 *
 * Phase 6 split: this module hosts the bounded vocabulary every
 * per-category redactor depends on. Keeping these declarations in a
 * single module avoids a circular dependency between the per-category
 * modules (which need the types) and the Facade (which composes them).
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §2.
 */

import type { Brand } from '../Brand.js';

/**
 * Default-deny replacement string — used whenever a value fails to
 * classify into a known {@link PiiCategory}.
 */
export const REDACTED_HINT = '[REDACTED]' as const;

/**
 * OTP replacement string — emitted by the OTP strategy for 4..8 ASCII
 * digit inputs. Centralised here so per-category modules import the
 * constant instead of hardcoding the literal (CLAUDE.md "Constants
 * from configuration — never hardcode values inline"; CR cycle-1 #9).
 */
export const OTP_HINT = '[OTP]' as const;

/**
 * Strategy-error replacement string — emitted when a redactor throws.
 * Keeps the pipeline running even if a single value triggers a bug.
 */
export const REDACTION_ERROR_HINT = '[REDACTION_ERROR]' as const;

/**
 * Amount-redaction sign markers. Centralised so the per-category
 * Amount strategy + any sibling reader (logs, fixtures, tests) share
 * one definition (CLAUDE.md "Constants from configuration — never
 * hardcode values inline"; CR cycle-2 finding on Amount.ts).
 *
 * `AMOUNT_NEGATIVE_HINT` masks negative magnitudes; `AMOUNT_POSITIVE_HINT`
 * masks positive magnitudes. The sign is preserved deliberately so
 * engineers retain debit/credit signal without exposing the magnitude.
 */
export const AMOUNT_NEGATIVE_HINT = '-***' as const;
export const AMOUNT_POSITIVE_HINT = '+***' as const;

/**
 * Default-on PII redaction. Set `PII_REDACTION=off` in `.env` to pass
 * business-data values through unmasked during local debugging. Auth
 * credentials (`token`, `otp`, `cookie`) are NEVER bypassed even with
 * this on — the unified `redact()` entry point in the Facade enforces
 * the no-bypass invariant via the `AuthCredentials` strategy.
 *
 * Read exactly once at module load; every downstream module reads
 * only this constant.
 */
export const isPiiRedactionDisabled: boolean = process.env.PII_REDACTION === 'off';

/** Stable PII hint string emitted by every redact strategy. */
export type PiiHintString = Brand<string, 'PiiHintString'>;

/** Boolean predicate result for PII classifiers. */
export type PiiClassifierBool = Brand<boolean, 'PiiClassifierBool'>;

/** Integer count returned by PII helpers (graphemes, indices). */
export type PiiCountInt = Brand<number, 'PiiCountInt'>;

/** Exhaustive PII classification. */
export type PiiCategory =
  | 'account'
  | 'card'
  | 'israeliId'
  | 'phone'
  | 'name'
  | 'merchant'
  | 'amount'
  | 'token'
  | 'otp'
  | 'cookie'
  | 'url'
  | 'html'
  | 'errorLog'
  | 'unknown';

/** Concrete JSON scalar union — used by the walker; no `unknown` leakage. */
export type JsonScalar = string | number | boolean | null;

/** JSON object — readonly map of strings to JsonValue. */
export interface IJsonObject {
  readonly [key: string]: JsonValue;
}

/** JSON array — readonly tuple of JsonValue. */
export type JsonArray = readonly JsonValue[];

/** Recursive JSON value union — scalar, object, or array. */
export type JsonValue = JsonScalar | IJsonObject | JsonArray;
