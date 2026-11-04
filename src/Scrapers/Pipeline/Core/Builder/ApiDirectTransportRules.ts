/**
 * Session-transport rules for an api-direct call config (N8). A `document`
 * step answers `{}`, so it reads no body extracts or outcome, and its marker
 * belongs only on that step. A manual redirect follows its hops as GETs, so it
 * runs only on a GET step — never as the bank default, which every POST
 * shares — allows at least one URL rule and 1–10 hops, and needs the bank
 * default `reject` so no other call follows a redirect unseen.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IManualRedirect } from '../../Types/Domain/FetchPolicy.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/** Most hops a manual redirect may follow. */
const MAX_REDIRECT_HOPS = 10;

/**
 * The step's manual redirect policy, when it names one.
 * @param step - Login step.
 * @returns The manual policy, or none.
 */
function manualOf(step: IStepConfig): readonly IManualRedirect[] {
  const policy = step.redirect;
  return typeof policy === 'object' ? [policy] : [];
}

/**
 * Every manual redirect policy the config's steps name.
 * @param input - Rule input.
 * @returns Manual policies, in step order.
 */
function manualPolicies(input: IApiDirectRuleInput): readonly IManualRedirect[] {
  const steps = allSteps(input.call);
  return steps.flatMap(manualOf);
}

/**
 * Whether a step reads any carry slot from its response body.
 * @param step - Login step.
 * @returns True when it names a required or optional body extract.
 */
function readsBodyExtracts(step: IStepConfig): boolean {
  const optional = step.optionalExtractsToCarry ?? {};
  const count = Object.keys(step.extractsToCarry).length + Object.keys(optional).length;
  return count > 0;
}

/**
 * Whether a step reads its answer body at all: through a body extract or an
 * outcome code.
 * @param step - Login step.
 * @returns True when it names a body extract or an outcome.
 */
function readsBody(step: IStepConfig): boolean {
  return readsBodyExtracts(step) || step.outcome !== undefined;
}

/**
 * A document step sees `{}`, so a body extract or outcome could never resolve.
 * @param input - Rule input.
 * @returns True when a document step names a body extract or an outcome.
 */
function isDocumentReadingBody(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some((step): boolean => step.response === 'document' && readsBody(step));
}

/**
 * A document marker is checked only on a document step; any other step reads
 * its 2xx answer as JSON and ignores the marker.
 * @param input - Rule input.
 * @returns True when a step names a marker without `response: 'document'`.
 */
function isMarkerOffDocument(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some(
    (step): boolean => step.documentMarker !== undefined && step.response !== 'document',
  );
}

/**
 * A manual hop is sent as a GET, so a POST step would lose its body.
 * @param input - Rule input.
 * @returns True when a non-GET step redirects manually.
 */
function isManualOffGet(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some((step): boolean => step.method !== 'GET' && manualOf(step).length > 0);
}

/**
 * The bank default runs every call, POSTs included.
 * @param input - Rule input.
 * @returns True when the bank default redirects manually.
 */
function isBankDefaultManual(input: IApiDirectRuleInput): boolean {
  if (input.headless === false) return false;
  return typeof input.headless.redirectPolicy === 'object';
}

/**
 * A manual policy with no allowed URL would refuse every hop.
 * @param input - Rule input.
 * @returns True when a manual policy allows no URL rule.
 */
function hasEmptyAllow(input: IApiDirectRuleInput): boolean {
  const policies = manualPolicies(input);
  return policies.some((policy): boolean => policy.allow.length === 0);
}

/**
 * Whether a manual policy's hop budget is a whole number in range.
 * @param policy - Manual policy.
 * @returns True when `maxHops` is not an integer from 1 to the ceiling.
 */
function isHopBudgetOutOfRange(policy: IManualRedirect): boolean {
  const hops = policy.maxHops;
  return !Number.isInteger(hops) || hops < 1 || hops > MAX_REDIRECT_HOPS;
}

/**
 * A manual policy must follow at least one hop and stay bounded.
 * @param input - Rule input.
 * @returns True when a manual policy's hop budget is out of range.
 */
function hasHopBudgetOutOfRange(input: IApiDirectRuleInput): boolean {
  const policies = manualPolicies(input);
  return policies.some(isHopBudgetOutOfRange);
}

/**
 * A bank that steers redirects by hand refuses them everywhere else.
 * @param input - Rule input.
 * @returns True when a step redirects manually but the bank default is not `reject`.
 */
function isManualWithoutRejectDefault(input: IApiDirectRuleInput): boolean {
  const policies = manualPolicies(input);
  if (policies.length === 0) return false;
  return input.headless === false || input.headless.redirectPolicy !== 'reject';
}

/** Session-transport rules, checked in order after the core rules. */
const API_DIRECT_TRANSPORT_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.response: a document step reads no body extracts or outcome',
    isBroken: isDocumentReadingBody,
  },
  { message: 'steps.documentMarker: only on a document step', isBroken: isMarkerOffDocument },
  { message: 'steps.redirect: manual only on GET steps', isBroken: isManualOffGet },
  { message: 'headless.redirectPolicy: manual only on GET steps', isBroken: isBankDefaultManual },
  { message: 'redirect.allow: must not be empty', isBroken: hasEmptyAllow },
  {
    message: `redirect.maxHops: must be an integer from 1 to ${String(MAX_REDIRECT_HOPS)}`,
    isBroken: hasHopBudgetOutOfRange,
  },
  {
    message: 'headless.redirectPolicy: must be reject when a step redirects manually',
    isBroken: isManualWithoutRejectDefault,
  },
];

export default API_DIRECT_TRANSPORT_RULES;
export { API_DIRECT_TRANSPORT_RULES };
