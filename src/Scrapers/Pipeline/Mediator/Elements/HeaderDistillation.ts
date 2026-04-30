/**
 * Header distillation — filters captured request headers to security-relevant ones.
 * Returns Procedure<DistilledHeaders> (Rule #15: no raw primitives).
 */

import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/** Header prefixes that are security-relevant (API auth tokens). */
const SECURITY_PREFIXES = ['authorization', 'x-site', 'x-xsrf', 'session'];

/** Header prefixes/keys that are browser noise — filter out. */
const NOISE_KEYS = new Set([
  'cookie',
  'user-agent',
  'host',
  'content-length',
  'content-type',
  'accept',
  'accept-language',
  'accept-encoding',
  'connection',
  'cache-control',
  'pragma',
]);

/** Header prefixes that are browser-generated noise. */
const NOISE_PREFIXES = ['sec-ch', 'sec-fetch', 'upgrade-'];

/** Headers that must always be kept (banking API requirements). */
const ALWAYS_KEEP = new Set(['origin', 'referer']);

/** Flag indicating whether to retain this header in the distilled set. */
type ShouldKeepFlag = boolean;

/**
 * Decision type — whether a header should be kept.
 * Uses ShouldKeepFlag to satisfy Rule #15 (no raw boolean in struct).
 */
interface IHeaderDecision {
  readonly shouldKeep: ShouldKeepFlag;
}

/** Distilled security-relevant headers ready for API calls. */
type DistilledHeaders = Record<string, string>;

/**
 * Check if a header key matches a security prefix.
 * @param key - Header key (lowercase).
 * @returns IHeaderDecision indicating security relevance.
 */
function isSecurityHeader(key: string): IHeaderDecision {
  /**
   * Accumulate security prefix match.
   * @param acc - Running decision.
   * @param p - Prefix to check.
   * @returns Updated decision.
   */
  const checkPrefix = (acc: IHeaderDecision, p: string): IHeaderDecision => {
    if (acc.shouldKeep) return acc;
    return { shouldKeep: key.startsWith(p) };
  };
  // Explicit reducer arrow (per SonarCloud rule typescript:S7727) — passing
  // checkPrefix directly leaks the implicit (acc, item, idx, array) signature
  // and lets typos in the reducer slip past the type checker. The arrow makes
  // the (acc, p) shape explicit.
  return SECURITY_PREFIXES.reduce<IHeaderDecision>(
    (acc, prefix): IHeaderDecision => checkPrefix(acc, prefix),
    { shouldKeep: false },
  );
}

/**
 * Check if a header key is browser noise.
 * @param key - Header key (lowercase).
 * @returns IHeaderDecision — shouldKeep true means it IS noise.
 */
function isNoiseHeader(key: string): IHeaderDecision {
  if (NOISE_KEYS.has(key)) return { shouldKeep: true };
  /**
   * Accumulate noise prefix match.
   * @param acc - Running decision.
   * @param p - Prefix to check.
   * @returns Updated decision.
   */
  const checkNoise = (acc: IHeaderDecision, p: string): IHeaderDecision => {
    if (acc.shouldKeep) return acc;
    return { shouldKeep: key.startsWith(p) };
  };
  // Explicit reducer arrow (per SonarCloud rule typescript:S7727).
  return NOISE_PREFIXES.reduce<IHeaderDecision>(
    (acc, prefix): IHeaderDecision => checkNoise(acc, prefix),
    { shouldKeep: false },
  );
}

/**
 * Decide whether a single header should be kept.
 * @param lower - Lowercased header key.
 * @returns IHeaderDecision with shouldKeep = true to retain the header.
 */
function shouldKeepHeader(lower: string): IHeaderDecision {
  if (ALWAYS_KEEP.has(lower)) return { shouldKeep: true };
  if (isNoiseHeader(lower).shouldKeep) return { shouldKeep: false };
  return isSecurityHeader(lower);
}

/**
 * Distill captured request headers to only security-relevant ones.
 * @param headers - Raw captured headers.
 * @returns Procedure with filtered headers (auth tokens, origin, site ID).
 */
function distillHeaders(headers: Record<string, string>): Procedure<DistilledHeaders> {
  /**
   * Accumulate kept headers by filtering noise.
   * @param acc - Accumulated distilled headers.
   * @param entry - One [key, value] pair to evaluate.
   * @returns Updated accumulated headers.
   */
  const buildKept = (acc: DistilledHeaders, entry: [string, string]): DistilledHeaders => {
    const lowerKey = entry[0].toLowerCase();
    if (!shouldKeepHeader(lowerKey).shouldKeep) return acc;
    return { ...acc, [entry[0]]: entry[1] };
  };
  // Explicit reducer arrow (per SonarCloud rule typescript:S7727).
  const kept = Object.entries(headers).reduce<DistilledHeaders>(
    (acc, entry): DistilledHeaders => buildKept(acc, entry),
    {},
  );
  return succeed(kept);
}

export default distillHeaders;
export type { DistilledHeaders, IHeaderDecision };
export { distillHeaders };
