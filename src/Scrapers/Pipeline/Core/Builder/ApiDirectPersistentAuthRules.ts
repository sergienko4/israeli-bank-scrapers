/**
 * Persistent-auth rules for an api-direct call config (N48). A
 * `persistentAuth` block must name a kind the mediator has a primer for
 * and a nonblank device-id carry field, before any durable run.
 */

import { isPersistentAuthKind } from '../../Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.durable.js';
import type { IApiDirectRule, IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/**
 * Whether the block names a kind no primer handles.
 * @param input - Rule input.
 * @returns True for a `persistentAuth` block of an unknown kind.
 */
function isUnknownKind(input: IApiDirectRuleInput): boolean {
  const block = input.call.persistentAuth;
  if (block === undefined) return false;
  return !isPersistentAuthKind(block.kind);
}

/**
 * Whether the device-id carry field names no slot.
 * @param input - Rule input.
 * @returns True for a persistent-auth block with a blank deviceIdField.
 */
function isDeviceIdFieldBlank(input: IApiDirectRuleInput): boolean {
  const block = input.call.persistentAuth;
  return block?.deviceIdField.trim() === '';
}

const API_DIRECT_PERSISTENT_AUTH_RULES: readonly IApiDirectRule[] = [
  {
    message: 'persistentAuth.kind: must be bound-device or device-memory',
    isBroken: isUnknownKind,
  },
  {
    message: 'persistentAuth.deviceIdField: must not be blank',
    isBroken: isDeviceIdFieldBlank,
  },
];

export default API_DIRECT_PERSISTENT_AUTH_RULES;
export { API_DIRECT_PERSISTENT_AUTH_RULES };
