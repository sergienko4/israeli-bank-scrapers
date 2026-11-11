/**
 * Transport rules for an api-direct call config. Reading, media type,
 * encoding, header carry, step-level strict UTF-8 and domain cookies work
 * on either node transport; redirect, status, failure-text, bank-wide
 * media-type and strict UTF-8 defaults need native fetch. Other transports
 * would ignore these fields, so the build refuses them. Domain jars need
 * `sessionCookies`; header and cookie names must be HTTP tokens. The
 * media-type value and strict UTF-8 override rules close the list.
 */

import type { IHeaderExtract } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { ITransportConfig } from '../../Registry/Config/PipelineBankConfigTypes.js';
import { API_DIRECT_COOKIE_RULES } from './ApiDirectCookieRules.js';
import { API_DIRECT_INTEGRITY_RULES } from './ApiDirectIntegrityRules.js';
import { API_DIRECT_MEDIA_RULES } from './ApiDirectMediaRules.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';
import { API_DIRECT_UTF8_RULES } from './ApiDirectUtf8Rules.js';

/** A step field one transport family acts on. */
type GatedStepField =
  | 'response'
  | 'documentMarker'
  | 'mediaType'
  | 'strictUtf8'
  | 'responseIntegrity'
  | 'redirect'
  | 'headerExtractsToCarry'
  | 'encoding';

/** Headless defaults not passed to the node:https strategy. */
const NATIVE_TRANSPORT_FIELDS = [
  'redirectPolicy',
  'statusPolicy',
  'omitBankText',
  'mediaTypes',
  'strictUtf8',
  'responseIntegrity',
  'isConnectRetryDisabled',
] as const;

/** A headless field one transport family acts on. */
type GatedTransportField = 'cookieDomains' | (typeof NATIVE_TRANSPORT_FIELDS)[number];

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
  return input.transport === false || input.transport.nativeFetch !== true;
}

/**
 * Whether a transport block selects node:https.
 * @param transport - The bank's transport block.
 * @returns True when a client certificate or a TLS profile is set.
 */
function isNodeTls(transport: ITransportConfig): boolean {
  const values = NODE_TLS_KEYS.map((key): unknown => transport[key]);
  return values.some((value): boolean => value !== undefined && value !== false);
}

/**
 * Whether the bank's calls run on neither node transport.
 * @param input - Rule input.
 * @returns True when they run without native fetch or node:https.
 */
function isNodeOff(input: IApiDirectRuleInput): boolean {
  if (input.transport === false) return true;
  return input.transport.nativeFetch !== true && !isNodeTls(input.transport);
}

const NATIVE_GATE: IFieldGate = {
  isOff: isNativeOff,
  offText: 'not allowed without transport.nativeFetch',
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
  ['strictUtf8', NODE_GATE],
  ['responseIntegrity', NATIVE_GATE],
  ['redirect', NATIVE_GATE],
  ['headerExtractsToCarry', NODE_GATE],
  ['encoding', NODE_GATE],
];

/** Headless fields and the transports that act on them, in check order. */
const TRANSPORT_FIELD_GATES: readonly (readonly [GatedTransportField, IFieldGate])[] = [
  ['cookieDomains', NODE_GATE],
  ...NATIVE_TRANSPORT_FIELDS.map((field): readonly [GatedTransportField, IFieldGate] => [
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
function hasTransportFieldOff(
  field: GatedTransportField,
  gate: IFieldGate,
  input: IApiDirectRuleInput,
): boolean {
  if (input.transport === false || !gate.isOff(input)) return false;
  return input.transport[field] !== undefined;
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
function transportFieldRule(entry: readonly [GatedTransportField, IFieldGate]): IApiDirectRule {
  const [field, gate] = entry;
  const isBroken = hasTransportFieldOff.bind(null, field, gate);
  return { message: `transport.${field}: ${gate.offText}`, isBroken };
}

/**
 * Domain cookies are shared through the session jar, which only
 * `sessionCookies` keeps.
 * @param input - Rule input.
 * @returns True when `cookieDomains` is set without `sessionCookies`.
 */
function isDomainJarWithoutSession(input: IApiDirectRuleInput): boolean {
  if (input.transport === false) return false;
  return input.transport.cookieDomains !== undefined && input.transport.sessionCookies !== true;
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
  const isDomainJar = input.transport !== false && input.transport.cookieDomains !== undefined;
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
const TRANSPORT_FIELD_RULES = TRANSPORT_FIELD_GATES.map((entry): IApiDirectRule =>
  transportFieldRule(entry),
);

/** Transport rules, checked in order after the session-transport rules. */
const API_DIRECT_NATIVE_RULES: readonly IApiDirectRule[] = [
  ...STEP_FIELD_RULES,
  ...TRANSPORT_FIELD_RULES,
  {
    message: 'transport.cookieDomains: not allowed without transport.sessionCookies',
    isBroken: isDomainJarWithoutSession,
  },
  {
    message: 'headerExtractsToCarry.header: must be an HTTP header name',
    isBroken: hasBadHeaderName,
  },
  {
    message: 'steps.setCookies: not allowed without transport.cookieDomains',
    isBroken: isSetCookieWithoutDomainJar,
  },
  { message: 'steps.setCookies: each name must be an HTTP token', isBroken: hasBadCookieName },
  ...API_DIRECT_COOKIE_RULES,
  ...API_DIRECT_MEDIA_RULES,
  ...API_DIRECT_UTF8_RULES,
  ...API_DIRECT_INTEGRITY_RULES,
];

export default API_DIRECT_NATIVE_RULES;
export { API_DIRECT_NATIVE_RULES, NATIVE_TRANSPORT_FIELDS };
