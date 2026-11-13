/**
 * Device-identity contracts — a per-user identity derived at runtime. A format
 * turns a host profile and a seed into the bank's signature shape; the provider
 * resolves the caller override, the token seed and the scope.
 */

import type { ScraperCredentials } from '../../../../Base/Interface.js';
import type { Procedure } from '../../../Types/Procedure.js';

/** Immutable host facts a signature format may use. */
interface IDeviceProfile {
  readonly hostName: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemory: number;
  readonly locale: string;
  readonly timeZone: string;
  readonly userAgent: string;
  readonly network: IDeviceNetwork;
}

/** The first non-internal IPv4 interface, or loopback defaults. */
interface IDeviceNetwork {
  readonly ipAddress: string;
  readonly netmaskAddress: string;
  readonly macAddress: string;
  readonly gatewayAddress: string;
  readonly broadcastAddress: string;
}

/** A signature format adapter, keyed by a stable name the bank config names. */
interface IDeviceSignatureFormat {
  readonly key: string;
  /**
   * Generate a signature from the host profile and a deterministic seed.
   * @param profile - Host facts.
   * @param seed - Stable per-user seed carried by the long-term token.
   * @returns The raw signature, or a typed failure.
   */
  generate(profile: IDeviceProfile, seed: string): Procedure<string>;
  /**
   * Validate a caller's override before it is sent.
   * @param value - Raw signature text.
   * @returns Success, or a typed failure naming no value.
   */
  validate(value: string): Procedure<true>;
}

/** The generic enricher the pipeline calls before the first phase. */
interface IDeviceIdentityProvider {
  /**
   * Fill the configured credential when the caller did not supply it.
   * @param credentials - Caller credentials.
   * @returns Enriched credentials, or a typed failure.
   */
  ensure(credentials: ScraperCredentials): Procedure<ScraperCredentials>;
}

export type { IDeviceIdentityProvider, IDeviceNetwork, IDeviceProfile, IDeviceSignatureFormat };
