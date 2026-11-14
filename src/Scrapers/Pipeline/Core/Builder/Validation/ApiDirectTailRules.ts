/**
 * Tail rules for an api-direct call config: the device-identity declaration
 * and the per-step HTTP failure map. Both run after the step rules; grouping
 * them here keeps each source file inside its dependency and line caps.
 */

import type { IApiDirectRule } from '../ApiDirectRuleInput.js';
import { API_DIRECT_HTTP_FAILURE_RULES } from './ApiDirectHttpFailureRules.js';
import API_DIRECT_DEVICE_IDENTITY_RULES from './DeviceIdentityRules.js';

/** Device-identity and HTTP-failure rules, in run order. */
const API_DIRECT_TAIL_RULES: readonly IApiDirectRule[] = [
  ...API_DIRECT_DEVICE_IDENTITY_RULES,
  ...API_DIRECT_HTTP_FAILURE_RULES,
];

export default API_DIRECT_TAIL_RULES;
