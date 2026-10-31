/**
 * Native-fetch rules for an api-direct call config (N8). Redirect, document,
 * status, failure-text, header-carry and body-encoding fields act only on
 * native fetch; any other transport would ignore them and run unguarded, so
 * naming one off native fetch fails the build. `cookieDomains` widens the
 * session jar, so it needs `sessionCookies`. A carried header name must be an
 * HTTP token.
 */

import type { IHeaderExtract } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/** Step fields only the headless native fetch acts on. */
const NATIVE_STEP_FIELDS = [
  'response',
  'documentMarker',
  'redirect',
  'headerExtractsToCarry',
  'encoding',
] as const;

/** Headless fields only the headless native fetch acts on. */
const NATIVE_HEADLESS_FIELDS = [
  'cookieDomains',
  'redirectPolicy',
  'statusPolicy',
  'omitBankText',
] as const;

/** A step field only the native fetch acts on. */
type NativeStepField = (typeof NATIVE_STEP_FIELDS)[number];

/** A headless field only the native fetch acts on. */
type NativeHeadlessField = (typeof NATIVE_HEADLESS_FIELDS)[number];

/** The rule text of a native-only field off native fetch. */
const OFF_NATIVE = 'not allowed without headless.nativeFetch';

/** An HTTP header name: one RFC 9110 token. */
const HEADER_NAME = /^[\w!#$%&'*+.^`|~-]+$/;

/**
 * Whether the bank's calls run anywhere but the headless native fetch.
 * @param input - Rule input.
 * @returns True when there is no headless block or `nativeFetch` is not set.
 */
function isNativeOff(input: IApiDirectRuleInput): boolean {
  return input.headless === false || input.headless.nativeFetch !== true;
}

/**
 * Whether a step names a native-only field while native fetch is off.
 * @param field - Native-only step field.
 * @param input - Rule input.
 * @returns True when any login or resume step sets the field off native fetch.
 */
function hasStepFieldOffNative(field: NativeStepField, input: IApiDirectRuleInput): boolean {
  if (!isNativeOff(input)) return false;
  const steps = allSteps(input.call);
  return steps.some((step): boolean => step[field] !== undefined);
}

/**
 * Whether the headless block names a native-only field while native fetch is off.
 * @param field - Native-only headless field.
 * @param input - Rule input.
 * @returns True when the headless block sets the field without `nativeFetch`.
 */
function hasHeadlessFieldOffNative(
  field: NativeHeadlessField,
  input: IApiDirectRuleInput,
): boolean {
  if (input.headless === false || input.headless.nativeFetch === true) return false;
  return input.headless[field] !== undefined;
}

/**
 * The rule refusing a native-only step field off native fetch.
 * @param field - Native-only step field.
 * @returns The rule.
 */
function stepFieldRule(field: NativeStepField): IApiDirectRule {
  const isBroken = hasStepFieldOffNative.bind(null, field);
  return { message: `steps.${field}: ${OFF_NATIVE}`, isBroken };
}

/**
 * The rule refusing a native-only headless field off native fetch.
 * @param field - Native-only headless field.
 * @returns The rule.
 */
function headlessFieldRule(field: NativeHeadlessField): IApiDirectRule {
  const isBroken = hasHeadlessFieldOffNative.bind(null, field);
  return { message: `headless.${field}: ${OFF_NATIVE}`, isBroken };
}

/**
 * Domain cookies are shared through the session jar, which only
 * `sessionCookies` keeps.
 * @param input - Rule input.
 * @returns True when `cookieDomains` is set without `sessionCookies`.
 */
function isDomainJarWithoutSession(input: IApiDirectRuleInput): boolean {
  if (input.headless === false) return false;
  return input.headless.cookieDomains !== undefined && input.headless.sessionCookies !== true;
}

/**
 * Whether a header carry slot names a header a response could carry.
 * @param extract - Header carry slot.
 * @returns True when the header name is an HTTP token.
 */
function isHeaderName(extract: IHeaderExtract): boolean {
  return HEADER_NAME.test(extract.header);
}

/**
 * A header carry slot that names no valid header could never be filled.
 * @param input - Rule input.
 * @returns True when any step carries a header whose name is not a token.
 */
function hasBadHeaderName(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  const extracts = steps.flatMap(step => Object.values(step.headerExtractsToCarry ?? {}));
  return !extracts.every(isHeaderName);
}

const STEP_FIELD_RULES = NATIVE_STEP_FIELDS.map((field): IApiDirectRule => stepFieldRule(field));
const HEADLESS_FIELD_RULES = NATIVE_HEADLESS_FIELDS.map((field): IApiDirectRule =>
  headlessFieldRule(field),
);

/** Native-fetch rules, checked in order after the session-transport rules. */
const API_DIRECT_NATIVE_RULES: readonly IApiDirectRule[] = [
  ...STEP_FIELD_RULES,
  ...HEADLESS_FIELD_RULES,
  {
    message: 'headless.cookieDomains: not allowed without headless.sessionCookies',
    isBroken: isDomainJarWithoutSession,
  },
  {
    message: 'headerExtractsToCarry.header: must be an HTTP header name',
    isBroken: hasBadHeaderName,
  },
];

export default API_DIRECT_NATIVE_RULES;
export { API_DIRECT_NATIVE_RULES, NATIVE_HEADLESS_FIELDS };
