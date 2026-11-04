/**
 * Cross-field rules for an api-direct call config and its bank's headless
 * block. They run when the pipeline is built, so a config that cannot work
 * fails before any run starts. The first broken rule fails the build as
 * `Generic` with `"<field>: <rule>"`. The session-transport rules live in
 * `ApiDirectTransportRules.ts` and run after these; the form-body rules in
 * `ApiDirectFormRules.ts` follow, then the seal rules in
 * `ApiDirectSealRules.ts` and the step-guard rules in `ApiDirectStepRules.ts`;
 * the native-fetch rules in `ApiDirectNativeRules.ts` run last.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { cookieJarWarmOf } from '../../Mediator/ApiDirectCall/Flow/WarmStartKind.js';
import { MAX_ACCESS_TOKEN_CHARS } from '../../Mediator/ApiDirectCall/PersistentAuthStateRules.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { API_DIRECT_FORM_RULES } from './ApiDirectFormRules.js';
import { API_DIRECT_NATIVE_RULES } from './ApiDirectNativeRules.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';
import { API_DIRECT_SEAL_RULES } from './ApiDirectSealRules.js';
import { API_DIRECT_STEP_RULES } from './ApiDirectStepRules.js';
import { API_DIRECT_TRANSPORT_RULES } from './ApiDirectTransportRules.js';

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
 * Refuse failure-map keys that collapse to the same code at runtime.
 * @param input - Rule input.
 * @returns True when a case-insensitive outcome has colliding keys.
 */
function hasCaselessFailureMapCollision(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some((step): boolean => {
    if (step.outcome?.caseInsensitive !== true) return false;
    const keys = Object.keys(step.outcome.failureMap).map((key): string => key.toLowerCase());
    return new Set(keys).size !== keys.length;
  });
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

/**
 * A warm start from step 0 replays the whole login, OTP step included, and is
 * charged to the run's one-SMS budget as a cold flow — so a rejected seed
 * leaves no budget for the cold retry. A warm start must skip the first step.
 * `isColdStart` charges index 0 even when there are no steps, so that case is
 * no exception.
 * @param input - Rule input.
 * @returns True when the warm start begins at or before step 0.
 */
function isWarmFromFirstStep(input: IApiDirectRuleInput): boolean {
  const warm = input.call.warmStart;
  if (warm === undefined) return false;
  return warm.fromStepIndex < 1;
}

/**
 * A warm start resumes on a step boundary: a whole index no greater than the
 * step count, where the count itself runs no steps. A fractional or NaN index
 * has the walker read a step that is not there and throw, skipping the cold
 * fallback; a larger one would silently run nothing, so it is a typo too.
 * @param input - Rule input.
 * @returns True when the warm start index is fractional, NaN or past the end.
 */
function isWarmOffStepBoundary(input: IApiDirectRuleInput): boolean {
  const warm = input.call.warmStart;
  if (warm === undefined) return false;
  const index = warm.fromStepIndex;
  return !Number.isInteger(index) || index > input.call.steps.length;
}

/**
 * 'bank-call' trusts its first warm step as the token check, so a `runIf`
 * guard that skips it would let an unchecked token through.
 * @param input - Rule input.
 * @returns True when the 'bank-call' check step has a `runIf` guard.
 */
function isBankCallCheckGuarded(input: IApiDirectRuleInput): boolean {
  const warm = input.call.warmStart;
  if (warm?.validation !== 'bank-call') return false;
  const entry = warm.fromStepIndex;
  return input.call.steps.some(
    (step, index): boolean => index === entry && step.runIf !== undefined,
  );
}

/**
 * Whether a config text names nothing.
 * @param text - Config text.
 * @returns True when empty or only whitespace.
 */
function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * A cookie-jar token is bound to a provider tag, so the tag must name one.
 * @param input - Rule input.
 * @returns True when a cookie-jar warm start has a blank `provider`.
 */
function isJarProviderBlank(input: IApiDirectRuleInput): boolean {
  const jar = cookieJarWarmOf(input.call);
  return jar !== false && isBlank(jar.provider);
}

/**
 * A cookie-jar token is bound to the account in a creds field, so the
 * field must be named.
 * @param input - Rule input.
 * @returns True when a cookie-jar warm start has a blank `accountField`.
 */
function isJarAccountFieldBlank(input: IApiDirectRuleInput): boolean {
  const jar = cookieJarWarmOf(input.call);
  return jar !== false && isBlank(jar.accountField);
}

/**
 * A cookie-jar token must fit a ceiling no wider than the one every stored
 * warm token already passes.
 * @param input - Rule input.
 * @returns True when `maxTokenChars` is not an integer from 1 to 16384.
 */
function isJarCeilingOutOfRange(input: IApiDirectRuleInput): boolean {
  const jar = cookieJarWarmOf(input.call);
  if (jar === false) return false;
  const max = jar.maxTokenChars;
  return !Number.isInteger(max) || max < 1 || max > MAX_ACCESS_TOKEN_CHARS;
}

/**
 * A cookie-jar warm start restores into, and exports from, the domain jar.
 * @param input - Rule input.
 * @returns True when a cookie-jar warm start has no `headless.cookieDomains`.
 */
function isJarWarmWithoutDomains(input: IApiDirectRuleInput): boolean {
  if (cookieJarWarmOf(input.call) === false) return false;
  return input.headless === false || input.headless.cookieDomains === undefined;
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
    message: 'outcome.failureMap: duplicate keys ignoring case',
    isBroken: hasCaselessFailureMapCollision,
  },
  {
    message: 'jwtClaims: required when warmStart.validation is jwt',
    isBroken: isJwtWarmWithoutClaims,
  },
  {
    message: 'warmStart.fromStepIndex: must name a step when validation is bank-call',
    isBroken: isBankCallWarmWithoutStep,
  },
  {
    message: 'warmStart.fromStepIndex: must start after the first step',
    isBroken: isWarmFromFirstStep,
  },
  {
    message: 'warmStart.fromStepIndex: must be a whole number up to the step count',
    isBroken: isWarmOffStepBoundary,
  },
  {
    message: 'warmStart.fromStepIndex: a bank-call check step must not have runIf',
    isBroken: isBankCallCheckGuarded,
  },
  { message: 'warmStart.provider: must not be blank', isBroken: isJarProviderBlank },
  { message: 'warmStart.accountField: must not be blank', isBroken: isJarAccountFieldBlank },
  {
    message: 'warmStart.maxTokenChars: must be an integer from 1 to 16384',
    isBroken: isJarCeilingOutOfRange,
  },
  {
    message: 'warmStart.kind: cookie-jar not allowed without headless.cookieDomains',
    isBroken: isJarWarmWithoutDomains,
  },
  ...API_DIRECT_TRANSPORT_RULES,
  ...API_DIRECT_FORM_RULES,
  ...API_DIRECT_SEAL_RULES,
  ...API_DIRECT_STEP_RULES,
  ...API_DIRECT_NATIVE_RULES,
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

export { validateApiDirectConfig };

export { type IApiDirectRuleInput } from './ApiDirectRuleInput.js';
