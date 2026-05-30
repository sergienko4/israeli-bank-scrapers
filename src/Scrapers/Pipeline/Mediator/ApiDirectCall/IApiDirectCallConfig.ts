/**
 * IApiDirectCallConfig — the data-only contract between banks and
 * the generic API-DIRECT-CALL phase. Each bank declares its login
 * flow as a literal value; the mediator reads selectors, signer
 * tags, canonical-string templates and fingerprint blobs without
 * bank-specific code.
 *
 * Introduced by Story 3 (rev18). Banks register the literal via
 * PIPELINE_BANK_CONFIG[bank].apiDirectCall — NO bank-side code
 * beyond the literal + pipeline descriptor + graphql queries.
 *
 * Rule #11 compliance: this file carries zero bank names. The
 * whole bank-specific surface is the config value passed at
 * wiring time.
 */

import type {
  IDerivedCarry,
  ISeedCarrySource,
  IWarmStartConfig,
  SeedCarryBootstrapKind,
} from './ConfigContracts/CarryTypes.js';
import type {
  AuthScheme,
  IFingerprintConfig,
  IJwtClaimsConfig,
  IPreStepHook,
  IProbeConfig,
} from './ConfigContracts/EnvelopeTypes.js';
import type { FlowKind, IStepConfig, StepName } from './ConfigContracts/FlowTypes.js';
import type {
  AsymmetricSignerAlgorithm,
  CanonicalPart,
  IAesSignerConfig,
  IAsymmetricSignerConfig,
  ICanonicalStringConfig,
  ICryptoFieldConfig,
  ISignerConfig,
  SignerAlgorithm,
  SignerEncoding,
} from './ConfigContracts/SignerTypes.js';
import type {
  IBodyTemplate,
  IEnvelopeSelectors,
  JsonValueTemplate,
  RefToken,
} from './ConfigContracts/TemplateTypes.js';

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

export type {
  AsymmetricSignerAlgorithm,
  AuthScheme,
  CanonicalPart,
  FlowKind,
  IAesSignerConfig,
  IApiDirectCallConfig,
  IAsymmetricSignerConfig,
  IBodyTemplate,
  ICanonicalStringConfig,
  ICryptoFieldConfig,
  IDerivedCarry,
  IEnvelopeSelectors,
  IFingerprintConfig,
  IJwtClaimsConfig,
  IPreStepHook,
  IProbeConfig,
  ISeedCarrySource,
  ISignerConfig,
  IStepConfig,
  IWarmStartConfig,
  JsonValueTemplate,
  RefToken,
  SeedCarryBootstrapKind,
  SignerAlgorithm,
  SignerEncoding,
  StepName,
};
