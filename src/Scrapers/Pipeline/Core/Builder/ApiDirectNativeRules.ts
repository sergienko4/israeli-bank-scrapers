/**
 * API-direct transport rules (N8). Bank-wide redirect, status and
 * failure-text defaults need native fetch. Step reading, header carry,
 * encoding and domain cookies also work over node:https, whose strategy
 * shares the native readers and session jar. Domain jars need
 * `sessionCookies`; header and cookie names must be HTTP tokens.
 */

import type { IHeaderExtract } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/** Step fields supported by node-backed identity transports. */
const NODE_STEP_FIELDS = [
  'response',
  'documentMarker',
  'redirect',
  'headerExtractsToCarry',
  'encoding',
] as const;

/** Headless defaults not passed to the node:https strategy. */
const NATIVE_HEADLESS_FIELDS = ['redirectPolicy', 'statusPolicy', 'omitBankText'] as const;

/** A step field supported by node-backed identity transports. */
type NodeStepField = (typeof NODE_STEP_FIELDS)[number];

/** A headless field only the native fetch acts on. */
type NativeHeadlessField = (typeof NATIVE_HEADLESS_FIELDS)[number];

/** The rule text of a native-only field off native fetch. */
const OFF_NATIVE = 'not allowed without headless.nativeFetch';

/** An HTTP header name: one RFC 9110 token. */
const HEADER_NAME = /^[\w!#$%&'*+.^`|~-]+$/;

/**
 * Whether the bank's calls run outside both node-backed identity transports.
 * @param input - Rule input.
 * @returns True when neither native fetch nor node:https is selected.
 */
function isNodeTransportOff(input: IApiDirectRuleInput): boolean {
  const headless = input.headless;
  if (headless === false) return true;
  const hasNodeTls =
    headless.requiresClientCert === true ||
    headless.tlsProfile !== undefined ||
    headless.clientCert !== undefined;
  return headless.nativeFetch !== true && !hasNodeTls;
}

/**
 * Whether a step names a node-backed field on browser transport.
 * @param field - Node-backed step field.
 * @param input - Rule input.
 * @returns True when any login or resume step sets the field without a node transport.
 */
function hasStepFieldOffNodeTransport(field: NodeStepField, input: IApiDirectRuleInput): boolean {
  if (!isNodeTransportOff(input)) return false;
  const steps = allSteps(input.call);
  return steps.some((step): boolean => step[field] !== undefined);
}

/**
 * Domain jars require a node-backed identity transport.
 * @param input - Rule input.
 * @returns True when a browser-backed bank declares domain cookies.
 */
function hasDomainJarOffNodeTransport(input: IApiDirectRuleInput): boolean {
  if (input.headless === false) return false;
  return input.headless.cookieDomains !== undefined && isNodeTransportOff(input);
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
 * The rule refusing a node-backed step field on browser transport.
 * @param field - Node-backed step field.
 * @returns The rule.
 */
function stepFieldRule(field: NodeStepField): IApiDirectRule {
  const isBroken = hasStepFieldOffNodeTransport.bind(null, field);
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

/**
 * Whether a step sets client cookies on a run without a domain jar.
 * @param input - Rule input.
 * @returns True when `setCookies` has no `cookieDomains` to write into.
 */
function isSetCookieWithoutDomainJar(input: IApiDirectRuleInput): boolean {
  const isDomainJar = input.headless !== false && input.headless.cookieDomains !== undefined;
  if (isDomainJar) return false;
  return allSteps(input.call).some((step): boolean => step.setCookies !== undefined);
}

/**
 * Whether a step sets a cookie whose name is not an HTTP token.
 * @param input - Rule input.
 * @returns True when a `setCookies` name is not a token.
 */
function hasBadCookieName(input: IApiDirectRuleInput): boolean {
  const steps = allSteps(input.call);
  const names = steps.flatMap((step): string[] => Object.keys(step.setCookies ?? {}));
  return !names.every((name): boolean => HEADER_NAME.test(name));
}

const STEP_FIELD_RULES = NODE_STEP_FIELDS.map((field): IApiDirectRule => stepFieldRule(field));
const HEADLESS_FIELD_RULES = NATIVE_HEADLESS_FIELDS.map((field): IApiDirectRule =>
  headlessFieldRule(field),
);

/** Native-fetch rules, checked in order after the session-transport rules. */
const API_DIRECT_NATIVE_RULES: readonly IApiDirectRule[] = [
  ...STEP_FIELD_RULES,
  {
    message: `headless.cookieDomains: ${OFF_NATIVE}`,
    isBroken: hasDomainJarOffNodeTransport,
  },
  ...HEADLESS_FIELD_RULES,
  {
    message: 'headless.cookieDomains: not allowed without headless.sessionCookies',
    isBroken: isDomainJarWithoutSession,
  },
  {
    message: 'headerExtractsToCarry.header: must be an HTTP header name',
    isBroken: hasBadHeaderName,
  },
  {
    message: 'steps.setCookies: not allowed without headless.cookieDomains',
    isBroken: isSetCookieWithoutDomainJar,
  },
  { message: 'steps.setCookies: each name must be an HTTP token', isBroken: hasBadCookieName },
];

export default API_DIRECT_NATIVE_RULES;
export { API_DIRECT_NATIVE_RULES, NATIVE_HEADLESS_FIELDS };
