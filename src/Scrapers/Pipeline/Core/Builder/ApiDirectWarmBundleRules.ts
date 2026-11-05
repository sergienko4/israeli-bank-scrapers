/**
 * Carry-bundle warm-start rules for an api-direct call config (N28). The
 * bundle binds to at least one named creds field, keeps at least one slot,
 * and every kept slot must be one a login step fills — a body or header
 * extract, or a carry-generator output — or the export could never succeed.
 * Keeping the jar needs a cookie-domain session to restore it into. The
 * provider and ceiling rules are shared with the cookie jar and run before
 * these, in `ApiDirectConfigRules.ts`.
 */

import type {
  ICarryBundleWarmStart,
  ICarryGenerator,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { carryBundleWarmOf } from '../../Mediator/ApiDirectCall/Flow/WarmStartKind.js';
import {
  hasCookieDomains,
  type IApiDirectRule,
  type IApiDirectRuleInput,
  isExtractSlot,
} from './ApiDirectRuleInput.js';

/** Flags a carry-bundle warm start against its rule input. */
type BundleCheck = (bundle: ICarryBundleWarmStart, input: IApiDirectRuleInput) => boolean;

/**
 * Run a check only when the config declares a carry-bundle warm start.
 * @param input - Rule input.
 * @param check - Bundle check.
 * @returns True when the bundle is flagged; false without a bundle.
 */
function isBundleBroken(input: IApiDirectRuleInput, check: BundleCheck): boolean {
  const bundle = carryBundleWarmOf(input.call);
  return bundle !== false && check(bundle, input);
}

/**
 * Whether the bundle names no account field, or a blank one.
 * @param bundle - Carry-bundle warm start.
 * @returns True when the token could not be bound.
 */
function isUnboundBundle(bundle: ICarryBundleWarmStart): boolean {
  const fields = bundle.accountFields;
  return fields.length === 0 || fields.some((field): boolean => field.trim().length === 0);
}

/**
 * Whether the bundle keeps no slot.
 * @param bundle - Carry-bundle warm start.
 * @returns True for an empty `slots`.
 */
function isSlotless(bundle: ICarryBundleWarmStart): boolean {
  return bundle.slots.length === 0;
}

/**
 * The slots a carry generator writes.
 * @param generator - Generator config.
 * @returns Its output slots; an unset rsa-key output is left out.
 */
function generatedSlots(generator: ICarryGenerator): readonly string[] {
  if (generator.kind === 'pkcs10-csr') return [generator.into];
  const outputs = [generator.keyInto, generator.spkiSha256HexInto];
  return outputs.filter((slot): slot is string => slot !== undefined);
}

/**
 * Whether a step fills a slot, by extract or by generator.
 * @param step - Login step.
 * @param slot - Kept slot.
 * @returns True when the step writes the slot.
 */
function isFilledBy(step: IStepConfig, slot: string): boolean {
  if (isExtractSlot(step, slot)) return true;
  const outputs = (step.generate ?? []).flatMap(generatedSlots);
  return outputs.includes(slot);
}

/**
 * Whether the bundle keeps a slot no login step fills.
 * @param bundle - Carry-bundle warm start.
 * @param input - Rule input.
 * @returns True when some kept slot is never written.
 */
function hasUnfilledSlot(bundle: ICarryBundleWarmStart, input: IApiDirectRuleInput): boolean {
  const steps = input.call.steps;
  return bundle.slots.some((slot): boolean => !steps.some(step => isFilledBy(step, slot)));
}

/**
 * Whether the bundle keeps the jar without a cookie-domain session.
 * @param bundle - Carry-bundle warm start.
 * @param input - Rule input.
 * @returns True when the jar has nowhere to be restored.
 */
function isJarWithoutDomains(bundle: ICarryBundleWarmStart, input: IApiDirectRuleInput): boolean {
  return bundle.cookies && !hasCookieDomains(input);
}

/**
 * Whether a carry-bundle warm start cannot be bound to an account.
 * @param input - Rule input.
 * @returns True for no account field, or a blank one.
 */
function isBundleUnbound(input: IApiDirectRuleInput): boolean {
  return isBundleBroken(input, isUnboundBundle);
}

/**
 * Whether a carry-bundle warm start keeps no slot.
 * @param input - Rule input.
 * @returns True for an empty `slots`.
 */
function isBundleSlotless(input: IApiDirectRuleInput): boolean {
  return isBundleBroken(input, isSlotless);
}

/**
 * Whether a carry-bundle warm start keeps a slot no login step fills.
 * @param input - Rule input.
 * @returns True when some kept slot is never written.
 */
function isBundleSlotUnfilled(input: IApiDirectRuleInput): boolean {
  return isBundleBroken(input, hasUnfilledSlot);
}

/**
 * Whether a carry-bundle warm start keeps the jar without cookie domains.
 * @param input - Rule input.
 * @returns True when the jar has nowhere to be restored.
 */
function isBundleJarWithoutDomains(input: IApiDirectRuleInput): boolean {
  return isBundleBroken(input, isJarWithoutDomains);
}

/** Carry-bundle rules, checked right after the cookie-jar rules. */
const API_DIRECT_WARM_BUNDLE_RULES: readonly IApiDirectRule[] = [
  {
    message: 'warmStart.accountFields: must name a creds field, none blank',
    isBroken: isBundleUnbound,
  },
  { message: 'warmStart.slots: must not be empty', isBroken: isBundleSlotless },
  {
    message: 'warmStart.slots: each slot must be filled by a login step',
    isBroken: isBundleSlotUnfilled,
  },
  {
    message: 'warmStart.cookies: not allowed without headless.cookieDomains',
    isBroken: isBundleJarWithoutDomains,
  },
];

export default API_DIRECT_WARM_BUNDLE_RULES;
export { API_DIRECT_WARM_BUNDLE_RULES };
