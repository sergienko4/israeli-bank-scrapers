/**
 * Status-map rules for an api-direct call config, on login and resume steps
 * alike. A step's `httpFailureMap` must not be empty, since it would type
 * nothing. Each key must be a 4xx status, the bank answering about the
 * user's input, and each value a login failure type: Generic is the default
 * already, and a no-reply or edge type would name the reply as something it
 * is not.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IStepConfig } from '../../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from '../ApiDirectRuleInput.js';

/** A 4xx status, as the transport writes it. */
const CLIENT_ERROR_STATUS = /^4\d\d$/;

/** The types a 4xx reply may stand for. */
const LOGIN_FAILURE_TYPES: ReadonlySet<ScraperErrorTypes> = new Set([
  ScraperErrorTypes.InvalidPassword,
  ScraperErrorTypes.ChangePassword,
  ScraperErrorTypes.AccountBlocked,
  ScraperErrorTypes.InvalidOtp,
]);

/** One step's status map. */
type StatusMap = NonNullable<IStepConfig['httpFailureMap']>;

/**
 * Whether one map entry names a 4xx status and a login failure type.
 * @param entry - Status and type.
 * @returns True for a good entry.
 */
function isGoodEntry(entry: readonly [string, ScraperErrorTypes]): boolean {
  const [status, type] = entry;
  return CLIENT_ERROR_STATUS.test(status) && LOGIN_FAILURE_TYPES.has(type);
}

/**
 * The status map of each login and resume step that sets one.
 * @param input - Rule input.
 * @returns The maps.
 */
function mapsOf(input: IApiDirectRuleInput): readonly StatusMap[] {
  const steps = allSteps(input.call);
  return steps.flatMap((step): StatusMap[] => (step.httpFailureMap ? [step.httpFailureMap] : []));
}

/**
 * Whether any step sets an empty status map.
 * @param input - Rule input.
 * @returns True when a map types nothing.
 */
function hasEmptyMap(input: IApiDirectRuleInput): boolean {
  const maps = mapsOf(input);
  return maps.some((map): boolean => Object.keys(map).length === 0);
}

/**
 * Whether any step maps a status that is not 4xx, or to a type no 4xx means.
 * @param input - Rule input.
 * @returns True for a bad entry.
 */
function hasBadEntry(input: IApiDirectRuleInput): boolean {
  const maps = mapsOf(input);
  return maps.some((map): boolean => !Object.entries(map).every(isGoodEntry));
}

/** The status-map rules, appended to the step rules. */
const API_DIRECT_HTTP_FAILURE_RULES: readonly IApiDirectRule[] = [
  { message: 'steps.httpFailureMap: must not be empty', isBroken: hasEmptyMap },
  {
    message: 'steps.httpFailureMap: must map 4xx statuses to login failure types',
    isBroken: hasBadEntry,
  },
];

export default API_DIRECT_HTTP_FAILURE_RULES;
export { API_DIRECT_HTTP_FAILURE_RULES };
