/**
 * Device-identity config — a per-user identity derived at runtime from a seed
 * the long-term token carries. The bank names the credential field, the format,
 * the token slot and the credential the seed is bound to.
 */

/** One device-identity declaration in a bank's api-direct call config. */
interface IDeviceIdentityConfig {
  /** Credential field the raw device signature is injected into. */
  readonly credential: string;
  /** Registered signature-format key, e.g. `risk-minder-mfp`. */
  readonly format: string;
  /** Carry slot the carry-bundle token keeps; the seed is random per user. */
  readonly seedSlot: string;
  /** Credential field the seed is bound to (e.g. `userCode`). */
  readonly scopeField: string;
}

export type { IDeviceIdentityConfig };
