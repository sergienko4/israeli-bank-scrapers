/**
 * GenericFingerprintBuilder — hydrates the fingerprint JsonValueTemplate
 * against the initial carry (per-user seeds) plus fresh-timestamp tokens
 * ($ref: 'now' / 'nowMs'). Banks declare whatever shape their server
 * expects; dynamic fields go through the same $ref engine as body
 * templates.
 */

import type { IJsonObject } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import type { IApiDirectCallConfig, IFingerprintConfig } from '../ConfigContracts/index.js';
import hydrate from '../Template/GenericBodyTemplate.js';
import type { ICollectionResult, ITemplateScope } from '../Template/RefResolver.js';

/**
 * Build a synthetic scope for fingerprint hydration — the initial carry,
 * empty creds, a throwaway config stub. `now` / `nowMs` and `carry.*`
 * refs resolve here; `creds.*` and `keypair.*` do not.
 * @param config - Real API-direct-call config (used for the scope.config slot).
 * @param carry - Initial carry seeded from creds before hydration.
 * @returns Template scope suitable for fingerprint hydration.
 */
function fingerprintScope(config: IApiDirectCallConfig, carry: IJsonObject): ITemplateScope {
  return {
    carry,
    creds: {},
    config,
  };
}

/**
 * Hydrate the fingerprint template to a fresh JsonValue.
 * @param fpConfig - Bank fingerprint config.
 * @param config - Full API-direct-call config (for $ref: 'config.*' use).
 * @param carry - Initial carry the fingerprint may read (defaults to empty).
 * @returns Procedure with the hydrated payload.
 */
function buildCollectionResult(
  fpConfig: IFingerprintConfig,
  config: IApiDirectCallConfig,
  carry: IJsonObject = {},
): Procedure<ICollectionResult> {
  const scope = fingerprintScope(config, carry);
  return hydrate(fpConfig.shape, scope);
}

export type { ICollectionResult } from '../Template/RefResolver.js';
export { buildCollectionResult };
