/**
 * Transport rules for an api-direct call config (N8). Reading, media type,
 * encoding, header carry and domain cookies work on either node transport;
 * redirect, status, failure-text and bank-wide media-type defaults need
 * native fetch. Other transports would ignore these fields, so the build
 * refuses them. Domain jars need `sessionCookies`; header and cookie names
 * must be HTTP tokens. Media type values must pass N61 rules.
 */

import type { IHeaderExtract } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IHeadlessUrlsConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';
import { API_DIRECT_MEDIA_RULES } from './ApiDirectMediaRules.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/** A step field one transport family acts on. */
type GatedStepField =
  'response' | 'documentMarker' | 'mediaType' | 'redirect' | 'headerExtractsToCarry' | 'encoding';

/** Headless defaults not passed to the node:https strategy. */
const NATIVE_HEADLESS_FIELDS = [
  'redirectPolicy',
  'statusPolicy',
  'omitBankText',
  'mediaTypes',
] as const;

/** A headless field one transport family acts on. */
type GatedHeadlessField = 'cookieDomains' | (typeof NATIVE_HEADLESS_FIELDS)[number];

/** The transports that act on a field, and the rule text off them. */
interface IFieldGate {
  /** Whether the bank's calls run on a transport that ignores the field. */
  readonly isOff: (input: IApiDirectRuleInput) => boolean;
  readonly offText: string;
}

/** Headless keys that put the bank's calls on node:https (as the transport pick reads them). */
const NODE_TLS_KEYS = ['clientCert', 'tlsProfile', 'requiresClientCert'] as const;

/** An HTTP header name: one RFC 9110 token. */
const HEADER_NAME = /^[\w!#$%&'*+.^`|~-]+$/;

/**
 * Whether the bank's calls run anywhere but the headless native fetch.
 * @param input - Rule input.
 * @returns True when native fetch is not selected.
 */
function isNativeOff(input: IApiDirectRuleInput): boolean {
  return input.headless === false || input.headless.nativeFetch !== true;
}

/**
 * Whether a headless block selects node:https.
 * @param headless - The bank's headless block.
 * @returns True when a client certificate or a TLS profile is set.
 */
function isNodeTls(headless: IHeadlessUrlsConfig): boolean {
  const values = NODE_TLS_KEYS.map((key): unknown => headless[key]);
  return values.some((value): boolean => value !== undefined && value !== false);
}

/**
 * Whether the bank's calls run on neither node transport.
 * @param input - Rule input.
 * @returns True when they run without native fetch or node:https.
 */
function isNodeOff(input: IApiDirectRuleInput): boolean {
  if (input.headless === false) return true;
  return input.headless.nativeFetch !== true && !isNodeTls(input.headless);
}

const NATIVE_GATE: IFieldGate = {
  isOff: isNativeOff,
  offText: 'not allowed without headless.nativeFetch',
};

const NODE_GATE: IFieldGate = {
  isOff: isNodeOff,
  offText: 'not allowed without nativeFetch or node:https',
};

/** Step fields and the transports that act on them, in check order. */
const STEP_FIELD_GATES: readonly (readonly [GatedStepField, IFieldGate])[] = [
  ['response', NODE_GATE],
  ['documentMarker', NODE_GATE],
  ['mediaType', NODE_GATE],
  ['redirect', NATIVE_GATE],
  ['headerExtractsToCarry', NODE_GATE],
  ['encoding', NODE_GATE],
];

/** Headless fields and the transports that act on them, in check order. */
const HEADLESS_FIELD_GATES: readonly (readonly [GatedHeadlessField, IFieldGate])[] = [
  ['cookieDomains', NODE_GATE],
  ...NATIVE_HEADLESS_FIELDS.map((field): readonly [GatedHeadlessField, IFieldGate] => [
    field,
    NATIVE_GATE,
  ]),
];

/**
 * Whether a step names a field its transport ignores.
 * @param field - Gated step field.
 * @param gate - The transports that act on it.
 * @param input - Rule input.
 * @returns True when any login or resume step sets the field off its transports.
 */
function hasStepFieldOff(
  field: GatedStepField,
  gate: IFieldGate,
  input: IApiDirectRuleInput,
): boolean {
  if (!gate.isOff(input)) return false;
  const steps = allSteps(input.call);
  return steps.some((step): boolean => step[field] !== undefined);
}

/**
 * Whether the headless block names a field its transport ignores.
 * @param field - Gated headless field.
 * @param gate - The transports that act on it.
 * @param input - Rule input.
 * @returns True when the headless block sets the field off its transports.
 */
function hasHeadlessFieldOff(
  field: GatedHeadlessField,
  gate: IFieldGate,
  input: IApiDirectRuleInput,
): boolean {
  if (input.headless === false || !gate.isOff(input)) return false;
  return input.headless[field] !== undefined;
}

/**
 * The rule refusing a step field off the transports that act on it.
 * @param entry - The field and its gate.
 * @returns The rule.
 */
function stepFieldRule(entry: readonly [GatedStepField, IFieldGate]): IApiDirectRule {
  const [field, gate] = entry;
  const isBroken = hasStepFieldOff.bind(null, field, gate);
  return { message: `steps.${field}: ${gate.offText}`, isBroken };
}

/**
 * The rule refusing a headless field off the transports that act on it.
 * @param entry - The field and its gate.
 * @returns The rule.
 */
function headlessFieldRule(entry: readonly [GatedHeadlessField, IFieldGate]): IApiDirectRule {
  const [field, gate] = entry;
  const isBroken = hasHeadlessFieldOff.bind(null, field, gate);
  return { message: `headless.${field}: ${gate.offText}`, isBroken };
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

const STEP_FIELD_RULES = STEP_FIELD_GATES.map((entry): IApiDirectRule => stepFieldRule(entry));
const HEADLESS_FIELD_RULES = HEADLESS_FIELD_GATES.map((entry): IApiDirectRule =>
  headlessFieldRule(entry),
);

/** Transport rules, checked in order after the session-transport rules. */
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
  {
    message: 'steps.setCookies: not allowed without headless.cookieDomains',
    isBroken: isSetCookieWithoutDomainJar,
  },
  { message: 'steps.setCookies: each name must be an HTTP token', isBroken: hasBadCookieName },
  ...API_DIRECT_MEDIA_RULES,
];

export default API_DIRECT_NATIVE_RULES;
export { API_DIRECT_NATIVE_RULES, NATIVE_HEADLESS_FIELDS };
