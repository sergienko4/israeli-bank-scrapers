/**
 * PiiRedactor Facade — unified `redact()` entry point + composer.
 *
 * Phase 8.5c / C1: split into per-concern modules. Routing (path-tail
 * classifier) lives in `Routing.ts`; per-category strategy registry
 * + Pino censor factory lives in `Dispatch.ts`. This module is now
 * the thin composer — owns the value-only `redact()` entry point
 * used by call-sites that lack a structured path (CLI, free-form
 * logger arguments) and re-exports the routing/dispatch surfaces
 * the parent barrel (`Types/PiiRedactor.ts`) consumes.
 *
 * Auth credentials (token / OTP / cookie) are matched FIRST inside
 * `redact()` and ALWAYS produce a stable hint — `PII_REDACTION=off`
 * cannot leak them through this entry point.
 *
 * Destinations covered (no bypass paths):
 *  - Pino terminal stream (pino-pretty)         via createCensorFn()
 *  - Pino file stream (pipeline.log)            via createCensorFn()
 *  - NetworkDiscovery.dumpResponseBody          via redactJsonBody()
 *  - FixtureCapture HTML / metadata writers     via redactHtml() /
 *                                               redactJsonBody()
 *  - Test result formatter                      via per-strategy exports
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §3.
 */

import { looksLikeCookie, looksLikeOtp, looksLikeToken } from './AuthCredentials.js';
import { OTP_HINT, type PiiHintString, REDACTED_HINT, REDACTION_ERROR_HINT } from './Types.js';

export type { CensorFn, CensorValue } from './Dispatch.js';
export { createCensorFn } from './Dispatch.js';
export { classifyKey, PATH_TAIL_TO_CATEGORY } from './Routing.js';

/**
 * Inner classification body for {@link redact}. Auth-credential
 * sniffers run FIRST so `PII_REDACTION=off` cannot leak them.
 * @param value - Candidate string already proven to be a string.
 * @returns Stable hint string.
 */
function redactStringValue(value: string): PiiHintString {
  if (looksLikeToken(value)) return REDACTED_HINT as PiiHintString;
  if (looksLikeOtp(value)) return OTP_HINT as PiiHintString;
  if (looksLikeCookie(value)) return REDACTED_HINT as PiiHintString;
  return REDACTED_HINT as PiiHintString;
}

/**
 * Unified PII redaction entry point. Default-deny: any unclassified
 * value yields {@link REDACTED_HINT}. Auth credentials (token / OTP /
 * cookie) are matched FIRST so `PII_REDACTION=off` cannot leak them.
 * @param value - Arbitrary input value.
 * @returns Stable hint string.
 */
export function redact(value: unknown): PiiHintString {
  if (typeof value !== 'string') return REDACTED_HINT as PiiHintString;
  try {
    return redactStringValue(value);
  } catch {
    return REDACTION_ERROR_HINT as PiiHintString;
  }
}
