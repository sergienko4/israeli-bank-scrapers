/**
 * Session rules for an api-direct call config, checked after the
 * client-certificate rules. Every `sessionCarry` slot (N32) must name a body
 * or header extract of some login or resume step: the scrape's session
 * context holds server-issued values only, so a generated key, a seeded
 * credential or a typo fails the build instead of reaching the scrape. An
 * `isolate` cookie hand-off (N35) needs a domain jar to empty. A
 * persistent-auth block must name a known `kind` (N48).
 */

import { API_DIRECT_PERSISTENT_AUTH_RULES } from './ApiDirectPersistentAuthRules.js';
import {
  allSteps,
  hasCookieDomains,
  type IApiDirectRule,
  type IApiDirectRuleInput,
  isExtractSlot,
} from './ApiDirectRuleInput.js';

/**
 * Whether some login or resume step extracts the slot.
 * @param input - Rule input.
 * @param slot - Allowlisted carry slot.
 * @returns True when a body or header extract names it.
 */
function isStepExtract(input: IApiDirectRuleInput, slot: string): boolean {
  const steps = allSteps(input.call);
  return steps.some(step => isExtractSlot(step, slot));
}

/**
 * Whether the allowlist names a slot no step extracts.
 * @param input - Rule input.
 * @returns True for an unknown `sessionCarry` slot.
 */
function hasUnknownSessionSlot(input: IApiDirectRuleInput): boolean {
  const slots = input.call.sessionCarry ?? [];
  return !slots.every(slot => isStepExtract(input, slot));
}

/**
 * Whether an `isolate` hand-off has no domain jar to empty.
 * @param input - Rule input.
 * @returns True for `isolate` without `headless.cookieDomains`.
 */
function isIsolateWithoutJar(input: IApiDirectRuleInput): boolean {
  return input.call.cookieHandoff === 'isolate' && !hasCookieDomains(input);
}

/** Session rules, checked in order. */
const API_DIRECT_SESSION_RULES: readonly IApiDirectRule[] = [
  { message: 'sessionCarry: each slot must name a step extract', isBroken: hasUnknownSessionSlot },
  {
    message: 'cookieHandoff: isolate not allowed without headless.cookieDomains',
    isBroken: isIsolateWithoutJar,
  },
  ...API_DIRECT_PERSISTENT_AUTH_RULES,
];

export default API_DIRECT_SESSION_RULES;

export { API_DIRECT_SESSION_RULES };
