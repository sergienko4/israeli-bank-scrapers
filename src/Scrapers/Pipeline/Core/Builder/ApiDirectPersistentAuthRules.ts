/**
 * Persistent-auth rules for an api-direct call config (N48). A
 * `persistentAuth` block must name a kind the mediator has a primer for;
 * an unknown kind is refused here rather than at the first durable run.
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

const API_DIRECT_PERSISTENT_AUTH_RULES: readonly IApiDirectRule[] = [
  {
    message: 'persistentAuth.kind: must be bound-device or device-memory',
    isBroken: isUnknownKind,
  },
];

export default API_DIRECT_PERSISTENT_AUTH_RULES;
export { API_DIRECT_PERSISTENT_AUTH_RULES };
