/**
 * ApiDirectCallConfig — top-level data-only contract between banks
 * and the generic API-DIRECT-CALL phase.
 *
 * Composes the five concern-slice sub-modules (TemplateTypes,
 * SignerTypes, CarryTypes, EnvelopeTypes, FlowTypes) into the
 * single IApiDirectCallConfig literal that banks register at
 * PIPELINE_BANK_CONFIG[bank].apiDirectCall. The data-only contract
 * keeps the mediator bank-agnostic: selectors, signer tags,
 * canonical-string templates and fingerprint blobs are passed at
 * wiring time, never via bank-specific code paths.
 *
 * Introduced by Story 3 (rev18). Bucket-5 (top) of the Phase 8 split
 * — depends on every other ConfigContracts sub-module.
 *
 * Rule #11 compliance: this file carries zero bank names. The whole
 * bank-specific surface is the config value passed at wiring time.
 */

import type { IDerivedCarry, ISeedCarrySource, IWarmStartConfig } from './CarryTypes.js';
import type { IDeviceIdentityConfig } from './DeviceIdentityTypes.js';
import type {
  AuthScheme,
  IFingerprintConfig,
  IJwtClaimsConfig,
  IProbeConfig,
} from './EnvelopeTypes.js';
import type { AuthRecovery, CookieHandoff, FlowKind, IStepConfig } from './FlowTypes.js';
import type { ISignerConfig } from './SignerTypes.js';
import type { IEnvelopeSelectors } from './TemplateTypes.js';

/**
 * Bound-device persistent auth — lets a caller hold opaque device-bound
 * state so later runs replay a fresh token or renew an expired one
 * through `resumeSteps` without a bind or OTP step. Data only: the
 * mediator owns every executable branch.
 */
interface IBoundDeviceAuthConfig {
  readonly kind: 'bound-device';
  /** Provider tag written into, and required back from, the opaque state. */
  readonly provider: string;
  /** Signed renewal steps against the persisted device, in order. */
  readonly resumeSteps: readonly IStepConfig[];
  /** Creds field, mirrored into carry, holding the stable client-instance UUID. */
  readonly clientInstanceIdField: string;
  /** Carry slot holding the server-issued device identifier. */
  readonly deviceIdField: string;
  /** Normalized creds field that binds the state to one account. */
  readonly accountField: string;
  /** Seconds before token expiry at which a stored token stops being replayed. */
  readonly freshnessMarginSeconds: number;
}

/**
 * Device-memory persistent auth — the opaque state holds only the
 * server-issued device id. A later run seeds it into carry before the
 * configured login flow, so the bank recognises the device and skips its
 * OTP step. No token, key or renewal step is stored.
 */
interface IDeviceMemoryAuthConfig {
  readonly kind: 'device-memory';
  /** Provider tag written into, and required back from, the opaque state. */
  readonly provider: string;
  /** Carry slot holding the server-issued device identifier. */
  readonly deviceIdField: string;
  /** Creds field binding the state to one account; compared lower-cased. */
  readonly accountField: string;
}

/** Opt-in persistent-auth block, one variant per `kind`. */
type IPersistentAuthConfig = IBoundDeviceAuthConfig | IDeviceMemoryAuthConfig;

/** Every persistent-auth variant tag. */
type PersistentAuthKind = IPersistentAuthConfig['kind'];

/** Rule a required credential must meet before the first request. */
type CredRule = 'nonEmpty' | 'digits' | 'sixDigits' | 'latin1';

/** Top-level config literal — placed into PIPELINE_BANK_CONFIG[bank].apiDirectCall. */
interface IApiDirectCallConfig {
  readonly flow: FlowKind;
  readonly steps: readonly IStepConfig[];
  readonly envelope: IEnvelopeSelectors;
  readonly signer?: ISignerConfig;
  readonly fingerprint?: IFingerprintConfig;
  readonly jwtClaims?: IJwtClaimsConfig;
  /**
   * Optional post-auth probe — lightweight first authenticated call
   * that smoke-tests the long-term token. Banks whose post-login
   * endpoints accept a bare body declare a probe here. Banks whose
   * endpoints require an additional body envelope (declared on the
   * scrape shape) omit the probe — their scrape-phase customer step
   * doubles as the smoke test.
   */
  readonly probe?: IProbeConfig;
  readonly staticHeaders?: Readonly<Record<string, string>>;
  /** How to format the final Authorization header value (default 'raw'). */
  readonly authScheme?: AuthScheme;
  /** Scheme word sent before the token when `authScheme` is 'prefixed'. */
  readonly authPrefix?: string;
  /** Optional warm-start shortcut — see IWarmStartConfig for semantics. */
  readonly warmStart?: IWarmStartConfig;
  /**
   * Carry slots handed to the scrape as its session context; every other
   * slot stays private to the login. Absent → the full carry snapshot.
   */
  readonly sessionCarry?: readonly string[];
  /**
   * What happens to the login's cookies when it finishes (default `shared`).
   * `isolate` needs `transport.cookieDomains`.
   */
  readonly cookieHandoff?: CookieHandoff;
  /** How the scrape recovers from a rejected session (default `per-request`). */
  readonly authRecovery?: AuthRecovery;
  /**
   * Static cryptographic literals accessible via `config.secrets.<name>`
   * RefTokens. Public-extractable constants (signing keys lifted from
   * APKs, fixed suffixes) live here; per-user secrets do not.
   */
  readonly secrets?: Readonly<Record<string, string>>;
  /**
   * Creds fields mirrored into `scope.carry` at flow init. Each entry
   * is either a plain field name (string) — value must be present on
   * `creds` or the flow fails fast — or a {@link ISeedCarrySource}
   * bootstrap spec that names a generator the mediator runs when the
   * creds value is absent.
   */
  readonly seedCarryFromCreds?: readonly (string | ISeedCarrySource)[];
  /**
   * One-time carry-slot derivations evaluated after `seedCarryFromCreds`
   * at flow init. Order matters when derivations depend on earlier ones.
   */
  readonly derivedCarry?: readonly IDerivedCarry[];
  /**
   * Optional per-user device identity the infrastructure derives before
   * login: the credential it fills, the signature format, the token seed slot
   * and the credential the seed binds to. A caller-supplied credential wins
   * over the derived value.
   */
  readonly deviceIdentity?: IDeviceIdentityConfig;
  /** Optional durable device-state support — see IPersistentAuthConfig. */
  readonly persistentAuth?: IPersistentAuthConfig;
  /**
   * Credentials checked before the first step. A missing or malformed field
   * fails the flow by name before any request is sent.
   */
  readonly requiredCreds?: Readonly<Record<string, CredRule>>;
  /**
   * Set for banks whose replies can quote the customer back. A missed
   * extract then names only the slot and pointer, and a failed scrape call
   * only the call and its HTTP status — never the bank's text.
   */
  readonly omitBankText?: true;
}

export type {
  CredRule,
  IApiDirectCallConfig,
  IBoundDeviceAuthConfig,
  IDeviceMemoryAuthConfig,
  IPersistentAuthConfig,
  PersistentAuthKind,
};
export type { IDeviceIdentityConfig } from './DeviceIdentityTypes.js';
