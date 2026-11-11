/**
 * Session rules for an api-direct call config, checked after the
 * client-certificate rules. Every `sessionCarry` slot must name a body
 * or header extract, a root JSON capture, or the final URL its manual redirect checked, of some
 * login or resume step: the scrape's session context holds server-issued
 * values only, so a generated key, a seeded
 * credential or a typo fails the build instead of reaching the scrape. An
 * `isolate` cookie hand-off needs a domain jar to empty. A
 * persistent-auth block must name a known `kind`.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { API_DIRECT_PERSISTENT_AUTH_RULES } from './ApiDirectPersistentAuthRules.js';
import {
  allSteps,
  hasCookieDomains,
  type IApiDirectRule,
  type IApiDirectRuleInput,
  isExtractSlot,
} from './ApiDirectRuleInput.js';

/**
 * Whether a step extracts the slot, or lands its checked final URL there.
 * @param step - Step config.
 * @param slot - Allowlisted carry slot.
 * @returns True when the step writes a server-issued value to the slot.
 */
function isServerSlot(step: IStepConfig, slot: string): boolean {
  const capture = step.structuredCapture;
  const isScriptSlot = capture?.kind === 'script-json' && capture.into === slot;
  return isScriptSlot || step.finalUrlInto === slot || isExtractSlot(step, slot);
}

/**
 * Whether some login or resume step extracts the slot.
 * @param input - Rule input.
 * @param slot - Allowlisted carry slot.
 * @returns True when a body or header extract, or a final URL, names it.
 */
function isStepExtract(input: IApiDirectRuleInput, slot: string): boolean {
  const steps = allSteps(input.call);
  return steps.some(step => isServerSlot(step, slot));
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
 * @returns True for `isolate` without `transport.cookieDomains`.
 */
function isIsolateWithoutJar(input: IApiDirectRuleInput): boolean {
  return input.call.cookieHandoff === 'isolate' && !hasCookieDomains(input);
}

/** Session rules, checked in order. */
const API_DIRECT_SESSION_RULES: readonly IApiDirectRule[] = [
  { message: 'sessionCarry: each slot must name a step extract', isBroken: hasUnknownSessionSlot },
  {
    message: 'cookieHandoff: isolate not allowed without transport.cookieDomains',
    isBroken: isIsolateWithoutJar,
  },
  ...API_DIRECT_PERSISTENT_AUTH_RULES,
];

export default API_DIRECT_SESSION_RULES;

export { API_DIRECT_SESSION_RULES };
