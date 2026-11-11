/**
 * Media type rules for an api-direct call config. A step's `mediaType`
 * and each of the bank's `transport.mediaTypes` defaults is one lower-case
 * `type/subtype` with no parameter — the form the transport compares the
 * answer's content-type against — and the defaults are keyed by response kind.
 */

import type { ResponseKind } from '../../Types/Domain/FetchPolicy.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/** One lower-case RFC 6838 `type/subtype`, without parameters. */
const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

/** Every response kind: the keys a bank's media type defaults may name. */
const RESPONSE_KINDS: Readonly<Record<ResponseKind, true>> = {
  json: true,
  document: true,
  text: true,
};

/**
 * The bank's media type defaults.
 * @param input - Rule input.
 * @returns The defaults by response kind, empty when the bank names none.
 */
function bankDefaultsOf(input: IApiDirectRuleInput): Readonly<Record<string, string>> {
  if (input.transport === false) return {};
  return input.transport.mediaTypes ?? {};
}

/**
 * Every media type the config names: each step's own, then the bank's defaults.
 * @param input - Rule input.
 * @returns The named media types.
 */
function namedMediaTypes(input: IApiDirectRuleInput): string[] {
  const steps = allSteps(input.call);
  const stepTypes = steps.flatMap((step): string[] =>
    step.mediaType === undefined ? [] : [step.mediaType],
  );
  const defaults = bankDefaultsOf(input);
  const bankTypes = Object.values(defaults);
  return [...stepTypes, ...bankTypes];
}

/**
 * A media type the transport could never match exactly.
 * @param input - Rule input.
 * @returns True when a named media type is not one lower-case `type/subtype`.
 */
function hasBadMediaType(input: IApiDirectRuleInput): boolean {
  const named = namedMediaTypes(input);
  return !named.every((mediaType): boolean => MEDIA_TYPE.test(mediaType));
}

/**
 * A bank default no call could read: its key names no response kind.
 * @param input - Rule input.
 * @returns True when a `transport.mediaTypes` key is not a response kind.
 */
function hasUnknownKind(input: IApiDirectRuleInput): boolean {
  const defaults = bankDefaultsOf(input);
  const kinds = Object.keys(defaults);
  return !kinds.every((kind): boolean => Object.hasOwn(RESPONSE_KINDS, kind));
}

/** Media type rules, checked after the transport gates (they close the native rules). */
const API_DIRECT_MEDIA_RULES: readonly IApiDirectRule[] = [
  { message: 'transport.mediaTypes: keys must be response kinds', isBroken: hasUnknownKind },
  { message: 'mediaType: must be a lower-case type/subtype', isBroken: hasBadMediaType },
];

export default API_DIRECT_MEDIA_RULES;
export { API_DIRECT_MEDIA_RULES };
