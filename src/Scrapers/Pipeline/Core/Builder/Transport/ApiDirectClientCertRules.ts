/**
 * Dynamic client-certificate rules for an api-direct call config. A
 * step `clientCert` installs through the port the transport `clientCert` block
 * creates, so it needs that block; the block's `origin` is compared exactly
 * with each request's URL origin, so it must be an exact https origin; and a
 * dynamic certificate replaces a registered one, so the two exclude.
 */

import type { IDynamicClientCert } from '../../../Types/Domain/ClientCertControl.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from '../ApiDirectRuleInput.js';

/**
 * The bank's dynamic client-certificate block.
 * @param input - Rule input.
 * @returns The block, or false when the bank declares none.
 */
function dynamicCertOf(input: IApiDirectRuleInput): IDynamicClientCert | false {
  if (input.transport === false) return false;
  return input.transport.clientCert ?? false;
}

/**
 * Whether a step installs a certificate the bank declares no port for.
 * @param input - Rule input.
 * @returns True when a step names `clientCert` without the transport block.
 */
function isStepCertWithoutBlock(input: IApiDirectRuleInput): boolean {
  if (dynamicCertOf(input) !== false) return false;
  return allSteps(input.call).some((step): boolean => step.clientCert !== undefined);
}

/**
 * Whether a text is exactly the origin a URL parser gives back for it.
 * @param origin - Declared origin.
 * @returns True for `https://host[:port]` with no path, user or default port.
 */
function isExactHttpsOrigin(origin: string): boolean {
  const parsed = URL.parse(origin);
  if (parsed === null) return false;
  return parsed.protocol === 'https:' && parsed.origin === origin;
}

/**
 * Whether the dynamic block names an origin no request could match exactly.
 * @param input - Rule input.
 * @returns True when the declared origin is not an exact https origin.
 */
function hasInexactOrigin(input: IApiDirectRuleInput): boolean {
  const cert = dynamicCertOf(input);
  if (cert === false) return false;
  return !isExactHttpsOrigin(cert.origin);
}

/**
 * Whether the bank declares both a dynamic and a registered certificate.
 * @param input - Rule input.
 * @returns True when `clientCert` and `requiresClientCert` are both set.
 */
function isDynamicWithRegistered(input: IApiDirectRuleInput): boolean {
  if (input.transport === false) return false;
  return input.transport.clientCert !== undefined && input.transport.requiresClientCert === true;
}

/** Dynamic client-certificate rules, checked after the carry-generator rules. */
const API_DIRECT_CLIENT_CERT_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps.clientCert: not allowed without transport.clientCert',
    isBroken: isStepCertWithoutBlock,
  },
  {
    message: 'transport.clientCert.origin: must be an exact https origin',
    isBroken: hasInexactOrigin,
  },
  {
    message: 'transport.clientCert: not allowed with transport.requiresClientCert',
    isBroken: isDynamicWithRegistered,
  },
];

export default API_DIRECT_CLIENT_CERT_RULES;
export { API_DIRECT_CLIENT_CERT_RULES };
