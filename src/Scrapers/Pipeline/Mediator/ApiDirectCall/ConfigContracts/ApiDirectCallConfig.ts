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
import type {
  AuthScheme,
  IFingerprintConfig,
  IJwtClaimsConfig,
  IProbeConfig,
} from './EnvelopeTypes.js';
import type { FlowKind, IStepConfig } from './FlowTypes.js';
import type { ISignerConfig } from './SignerTypes.js';
import type { IEnvelopeSelectors } from './TemplateTypes.js';

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
  /** Optional warm-start shortcut — see IWarmStartConfig for semantics. */
  readonly warmStart?: IWarmStartConfig;
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
}

export type { IApiDirectCallConfig };
