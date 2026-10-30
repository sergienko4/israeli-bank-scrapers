/**
 * Cross-field rules for an api-direct call config and its bank's headless
 * block. They run when the pipeline is built, so a config that cannot work
 * fails before any run starts. The first broken rule fails the build as
 * `Generic` with `"<field>: <rule>"`.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IHeadlessUrlsConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** What the rules read: the call config and the bank's headless block. */
interface IApiDirectRuleInput {
  readonly call: IApiDirectCallConfig;
  readonly headless: IHeadlessUrlsConfig | false;
}

/** One rule: the failure text and the check that finds it broken. */
interface IApiDirectRule {
  readonly message: string;
  readonly isBroken: (input: IApiDirectRuleInput) => boolean;
}

/**
 * Every login step, including durable resume steps.
 * @param call - Call config.
 * @returns All steps the config can run.
 */
function allSteps(call: IApiDirectCallConfig): readonly IStepConfig[] {
  const resume = call.persistentAuth?.resumeSteps ?? [];
  return [...call.steps, ...resume];
}

/**
 * Whether the bank's headless block keeps a session cookie jar.
 * @param input - Rule input.
 * @returns True when `headless.sessionCookies` is set.
 */
function hasSessionCookies(input: IApiDirectRuleInput): boolean {
  return input.headless !== false && input.headless.sessionCookies === true;
}

/**
 * 'prefixed' needs a non-blank scheme word to send before the token.
 * @param input - Rule input.
 * @returns True when the prefix is missing or blank.
 */
function isPrefixMissing(input: IApiDirectRuleInput): boolean {
  if (input.call.authScheme !== 'prefixed') return false;
  const prefix = input.call.authPrefix ?? '';
  return prefix.trim().length === 0;
}

/**
 * 'none' sends no auth header, so the session must ride on cookies.
 * @param input - Rule input.
 * @returns True when 'none' has no session cookie jar.
 */
function isNoneWithoutCookies(input: IApiDirectRuleInput): boolean {
  return input.call.authScheme === 'none' && !hasSessionCookies(input);
}

/**
 * The run-wide jar and a step's own jar would both send a cookie header.
 * @param input - Rule input.
 * @returns True when both jars are on.
 */
function isJarDoubled(input: IApiDirectRuleInput): boolean {
  if (!hasSessionCookies(input)) return false;
  const steps = allSteps(input.call);
  return steps.some((step): boolean => step.cookieJar === true);
}

/**
 * An outcome with no success codes would refuse every response.
 * @param input - Rule input.
 * @returns True when any step's outcome lists no success codes.
 */
function hasEmptySuccessCodes(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  return steps.some((step): boolean => step.outcome?.successCodes.length === 0);
}

/**
 * The 'jwt' warm check needs claims to judge freshness locally.
 * @param input - Rule input.
 * @returns True when 'jwt' validation has no `jwtClaims`.
 */
function isJwtWarmWithoutClaims(input: IApiDirectRuleInput): boolean {
  const warm = input.call.warmStart;
  if (warm === undefined) return false;
  const validation = warm.validation ?? 'jwt';
  return validation === 'jwt' && input.call.jwtClaims === undefined;
}

/**
 * 'bank-call' trusts the first warm step as the token check, so a warm
 * start must run at least one step.
 * @param input - Rule input.
 * @returns True when 'bank-call' validation starts outside the step list.
 */
function isBankCallWarmWithoutStep(input: IApiDirectRuleInput): boolean {
  const warm = input.call.warmStart;
  if (warm?.validation !== 'bank-call') return false;
  const index = warm.fromStepIndex;
  const isStep = Number.isInteger(index) && index >= 0 && index < input.call.steps.length;
  return !isStep;
}

/** Every rule, checked in order. */
const API_DIRECT_RULES: readonly IApiDirectRule[] = [
  { message: 'authPrefix: required when authScheme is prefixed', isBroken: isPrefixMissing },
  {
    message: 'headless.sessionCookies: required when authScheme is none',
    isBroken: isNoneWithoutCookies,
  },
  {
    message: 'steps.cookieJar: not allowed with headless.sessionCookies',
    isBroken: isJarDoubled,
  },
  { message: 'outcome.successCodes: must not be empty', isBroken: hasEmptySuccessCodes },
  {
    message: 'jwtClaims: required when warmStart.validation is jwt',
    isBroken: isJwtWarmWithoutClaims,
  },
  {
    message: 'warmStart.fromStepIndex: must name a step when validation is bank-call',
    isBroken: isBankCallWarmWithoutStep,
  },
];

/**
 * Check a call config against its bank's headless block.
 * @param input - Call config and headless block.
 * @returns Success, or a Generic failure naming the first broken rule.
 */
function validateApiDirectConfig(input: IApiDirectRuleInput): Procedure<true> {
  const broken = API_DIRECT_RULES.find((rule): boolean => rule.isBroken(input));
  if (broken === undefined) return succeed(true);
  return fail(ScraperErrorTypes.Generic, broken.message);
}

export type { IApiDirectRuleInput };
export { validateApiDirectConfig };
