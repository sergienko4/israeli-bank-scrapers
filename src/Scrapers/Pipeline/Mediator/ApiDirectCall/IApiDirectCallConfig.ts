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

import type { WKQueryOperation } from '../../Registry/WK/QueriesWK.js';
import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type {
  IDerivedCarry,
  ISeedCarrySource,
  IWarmStartConfig,
  SeedCarryBootstrapKind,
} from './ConfigContracts/CarryTypes.js';
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

/** Exhaustive flow-kind discriminator (spec.txt §B.3). */
type FlowKind = 'sms-otp' | 'stored-jwt' | 'bearer-static';

/** Step identifiers in the sms-otp flow. */
type StepName = 'bind' | 'assertPassword' | 'assertOtp' | 'getIdToken' | 'sessionToken';

/**
 * Fingerprint shape consumed by GenericFingerprintBuilder. The shape
 * is a JsonValueTemplate hydrated at bind-time against a scope that
 * carries only fresh-timestamp tokens ($ref: 'now' / 'nowMs') — no
 * carry/creds/keypair. Banks embed any structure their server
 * requires; dynamic timestamps go in via the tokens.
 */
interface IFingerprintConfig {
  readonly shape: JsonValueTemplate;
}

/** JWT freshness configuration consumed by GenericJwtClaims. */
interface IJwtClaimsConfig {
  readonly freshnessField: 'exp' | 'nbf';
  readonly skewSeconds: number;
}

/** Authorization scheme — "raw" for verbatim JWT, "bearer" for "Bearer <jwt>". */
type AuthScheme = 'raw' | 'bearer';

/**
 * Per-step pre-hook — before the step fires, await a function on
 * creds and deposit the result into scope.carry[intoCarryField].
 * Used for OTP retriever callbacks (carry.otpCode).
 */
interface IPreStepHook {
  readonly awaitCredsField: string;
  readonly intoCarryField: string;
  /**
   * Optional encryption step — when set, the deposited carry value
   * is AES-encrypted into the body at the configured pointer and
   * the plaintext is scrubbed from carry so it cannot leak via
   * debug traces or replay artifacts.
   */
  readonly cryptoField?: ICryptoFieldConfig;
}

/** Post-auth probe configuration — EXACTLY ONE of queryTag / urlTag. */
interface IProbeConfig {
  readonly queryTag?: WKQueryOperation;
  readonly urlTag?: WKUrlGroup;
}

/** Per-step config: name, URL tag, body template, response-extract selectors. */
interface IStepConfig {
  readonly name: StepName;
  readonly urlTag: WKUrlGroup;
  readonly body: IBodyTemplate;
  readonly extractsToCarry: IEnvelopeSelectors;
  /** Optional hook — awaited before the step fires. */
  readonly preHook?: IPreStepHook;
  /**
   * Optional URL query params — hydrated JsonValueTemplate whose
   * root is an object whose string-valued leaves become the
   * outgoing ?k=v pairs. Values may be $ref / $literal / nested.
   */
  readonly queryTemplate?: JsonValueTemplate;
  /**
   * When true, captures this step's response Set-Cookie lines into
   * the internal cookie jar. Subsequent steps with cookieJar=true
   * include those cookies on the outbound Cookie header.
   */
  readonly cookieJar?: boolean;
}

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
