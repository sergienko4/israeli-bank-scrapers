/**
 * GenericFingerprintBuilder — hydrates the fingerprint JsonValueTemplate
 * against a minimal scope carrying only fresh-timestamp tokens ($ref:
 * 'now' / 'nowMs'). Banks declare whatever shape their server expects;
 * dynamic fields go through the same $ref engine as body templates.
 */

import type { Procedure } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IApiDirectCallConfig, IFingerprintConfig } from '../IApiDirectCallConfig.js';
import { hydrate } from '../Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../Template/RefResolver.js';

/** Alias preserved for callers — the fingerprint is an opaque JsonValue. */
type ICollectionResult = JsonValue;

/**
 * Build a synthetic scope for fingerprint hydration — empty carry,
 * empty creds, a throwaway config stub. Only `now` / `nowMs` refs
 * resolve meaningfully here.
 * @param config - Real API-direct-call config (used for the scope.config slot).
 * @returns Template scope suitable for fingerprint hydration.
 */
function fingerprintScope(config: IApiDirectCallConfig): ITemplateScope {
  return {
    carry: {},
    creds: {},
    config,
  };
}

/**
 * Hydrate the fingerprint template to a fresh JsonValue.
 * @param fpConfig - Bank fingerprint config.
 * @param config - Full API-direct-call config (for $ref: 'config.*' use).
 * @returns Procedure with the hydrated payload.
 */
function buildCollectionResult(
  fpConfig: IFingerprintConfig,
  config: IApiDirectCallConfig,
): Procedure<ICollectionResult> {
  const scope = fingerprintScope(config);
  return hydrate(fpConfig.shape, scope);
}

export type { ICollectionResult };
export default buildCollectionResult;
export { buildCollectionResult };
