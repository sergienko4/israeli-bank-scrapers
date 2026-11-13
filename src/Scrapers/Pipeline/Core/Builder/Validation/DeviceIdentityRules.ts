/**
 * Device-identity config rules: the credential, format, seed slot and scope
 * are plain names, and the carry-bundle warm start must keep the seed slot.
 * A broken declaration fails the build before any scrape.
 */

import DEVICE_SIGNATURE_FORMATS from '../../../Mediator/ApiDirectCall/DeviceIdentity/DeviceSignatureFormats.js';
import type { IApiDirectRule, IApiDirectRuleInput } from '../ApiDirectRuleInput.js';

/** A plain credential or slot name. */
const FIELD_NAME = /^[a-z]\w{0,63}$/iu;

/**
 * Whether a format key has a registered adapter.
 * @param format - Format key from the config.
 * @returns True when the registry holds it.
 */
function isKnownFormat(format: string): boolean {
  return Object.hasOwn(DEVICE_SIGNATURE_FORMATS, format);
}

/**
 * Whether the credential field is not a plain name.
 * @param input - Rule input.
 * @returns True when the declaration is broken.
 */
function isBadCredential(input: IApiDirectRuleInput): boolean {
  const config = input.call.deviceIdentity;
  return config !== undefined && !FIELD_NAME.test(config.credential);
}

/**
 * Whether the format key has no adapter.
 * @param input - Rule input.
 * @returns True when the declaration is broken.
 */
function isUnknownFormat(input: IApiDirectRuleInput): boolean {
  const config = input.call.deviceIdentity;
  return config !== undefined && !isKnownFormat(config.format);
}

/**
 * Whether the seed slot is not a plain name.
 * @param input - Rule input.
 * @returns True when the declaration is broken.
 */
function isBadSeedSlot(input: IApiDirectRuleInput): boolean {
  const config = input.call.deviceIdentity;
  return config !== undefined && !FIELD_NAME.test(config.seedSlot);
}

/**
 * Whether the scope field is not a plain name.
 * @param input - Rule input.
 * @returns True when the declaration is broken.
 */
function isBadScope(input: IApiDirectRuleInput): boolean {
  const config = input.call.deviceIdentity;
  return config !== undefined && !FIELD_NAME.test(config.scopeField);
}

/**
 * Whether the warm start cannot carry the seed slot.
 * @param input - Rule input.
 * @returns True when the declaration is broken.
 */
function isSeedNotCarried(input: IApiDirectRuleInput): boolean {
  const config = input.call.deviceIdentity;
  if (config === undefined) return false;
  const warm = input.call.warmStart;
  if (warm?.kind !== 'carry-bundle') return true;
  return !warm.slots.includes(config.seedSlot);
}

/** Device-identity rules, checked with the other cross-field rules. */
const API_DIRECT_DEVICE_IDENTITY_RULES: readonly IApiDirectRule[] = [
  { message: 'deviceIdentity.credential: must be a plain field name', isBroken: isBadCredential },
  { message: 'deviceIdentity.format: must be a registered format', isBroken: isUnknownFormat },
  { message: 'deviceIdentity.seedSlot: must be a plain slot name', isBroken: isBadSeedSlot },
  { message: 'deviceIdentity.scopeField: must be a plain field name', isBroken: isBadScope },
  {
    message: 'deviceIdentity.seedSlot: warmStart must carry it',
    isBroken: isSeedNotCarried,
  },
];

export default API_DIRECT_DEVICE_IDENTITY_RULES;
