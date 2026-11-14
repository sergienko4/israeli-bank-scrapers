/**
 * Device-identity enricher — binds the generic provider to the builder's
 * credential-enrichment seam. Kept beside the provider so the provider owns
 * derivation only and this module owns the format registry and enricher
 * lifecycle.
 */

import type { ScraperCredentials } from '../../../../Base/Interface.js';
import { none, type Option, some } from '../../../Types/Option.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk } from '../../../Types/Procedure.js';
import type { IDeviceIdentityConfig, IWarmStartConfig } from '../ConfigContracts/index.js';
import createDeviceIdentityProvider from './DeviceIdentityProvider.js';
import type { IDeviceIdentityProvider } from './DeviceIdentityTypes.js';

/** The credential-enrichment seam the pipeline builder attaches. */
type CredentialEnricher = (credentials: ScraperCredentials) => Procedure<ScraperCredentials>;

/**
 * Bind a built provider to the enricher signature.
 * @param provider - Built provider.
 * @returns An enricher that delegates to it.
 */
function enricherOf(provider: IDeviceIdentityProvider): CredentialEnricher {
  return credentials => provider.ensure(credentials);
}

/**
 * Build an enricher, or one that re-emits the provider's build failure.
 * @param config - Bank device-identity declaration.
 * @param warmStart - Bank warm-start config, when it carries the seed.
 * @returns The enricher.
 */
function builtEnricher(
  config: IDeviceIdentityConfig,
  warmStart?: IWarmStartConfig,
): CredentialEnricher {
  const provider = createDeviceIdentityProvider(config, warmStart);
  if (!isOk(provider)) return () => provider;
  return enricherOf(provider.value);
}

/**
 * Build the enricher a bank's `deviceIdentity` config selects.
 * @param config - Bank device-identity declaration, when present.
 * @param warmStart - Bank warm-start config, when it carries the seed.
 * @returns Some(enricher), or none when the bank declares none.
 */
function deviceIdentityEnricherOf(
  config?: IDeviceIdentityConfig,
  warmStart?: IWarmStartConfig,
): Option<CredentialEnricher> {
  if (config === undefined) return none();
  const enrich = builtEnricher(config, warmStart);
  return some(enrich);
}

export default deviceIdentityEnricherOf;
export { deviceIdentityEnricherOf };
export type { CredentialEnricher };
