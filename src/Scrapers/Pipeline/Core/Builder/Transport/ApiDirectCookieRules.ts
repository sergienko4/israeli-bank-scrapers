/**
 * Validates client-cookie sources before the configured flow can run.
 */

import type { JsonUnknown, JsonUnknownRecord } from '../../../Types/JsonValue.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from '../ApiDirectRuleInput.js';

const FIXED_REFS: ReadonlySet<string> = new Set([
  'fingerprint',
  'uuid',
  'now',
  'nowMs',
  'keypair.ec.publicKeyBase64',
  'keypair.rsa.publicKeyBase64',
]);
const REF_PREFIXES = ['carry.', 'creds.', 'config.', 'cookie.'] as const;
const NONBLANK_REF_SUFFIX = /^\S+$/u;

/**
 * Identifies a record at the config boundary.
 * @param value - Candidate value.
 * @returns True for a non-array record.
 */
function isRecord(value: JsonUnknown): value is JsonUnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks that a cookie source names a known ref and a nonblank target.
 * @param value - Candidate ref.
 * @returns True for a known ref.
 */
function isCookieRef(value: JsonUnknown): boolean {
  if (typeof value !== 'string') return false;
  if (FIXED_REFS.has(value)) return true;
  return REF_PREFIXES.some((prefix): boolean => {
    const suffix = value.slice(prefix.length);
    return value.startsWith(prefix) && NONBLANK_REF_SUFFIX.test(suffix);
  });
}

/**
 * Checks a required ref or an exact optional-ref entry.
 * @param value - Candidate cookie source.
 * @returns True when the source has a supported shape.
 */
function isCookieSource(value: JsonUnknown): boolean {
  if (typeof value === 'string') return isCookieRef(value);
  if (!isRecord(value)) return false;
  if (Object.keys(value).length !== 2) return false;
  if (!Object.hasOwn(value, 'ref') || !Object.hasOwn(value, 'optional')) return false;
  return value.optional === true && isCookieRef(value.ref);
}

/**
 * Checks each login and resume step's declared cookie sources.
 * @param input - Rule input.
 * @returns True for any invalid source declaration.
 */
function hasBadCookieSource(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(step => {
    const sources = step.setCookies;
    if (sources === undefined) return false;
    return !isRecord(sources) || !Object.values(sources).every(isCookieSource);
  });
}

const API_DIRECT_COOKIE_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.setCookies: each source must be a valid ref or optional ref',
    isBroken: hasBadCookieSource,
  },
];

export default API_DIRECT_COOKIE_RULES;
export { API_DIRECT_COOKIE_RULES, isCookieRef };
