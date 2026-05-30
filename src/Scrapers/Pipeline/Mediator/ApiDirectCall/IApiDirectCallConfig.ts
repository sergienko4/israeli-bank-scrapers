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
 * Warm-start config — when creds[credsField] is populated (and
 * JWT-fresh if jwtClaims configured), SmsOtpFlow pre-seeds
 * scope.carry[carryField] with that creds value and starts iterating
 * steps from fromStepIndex. fromStepIndex === steps.length means
 * zero steps run (Pepper: stored value IS the final token).
 */
interface IWarmStartConfig {
  readonly credsField: string;
  readonly carryField: string;
  readonly fromStepIndex: number;
}

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

/**
 * Random 16-byte hex bootstrap — non-deterministic, fresh per process.
 * Used when the carry slot just needs a unique opaque token.
 */
type IRandomHex16Bootstrap = 'random-hex-16';

/**
 * Deterministic 16-hex bootstrap derived from another creds field via
 * `sha256(creds[from]).slice(0, 16)`. Used when the carry slot must
 * stay stable across warm-start runs (e.g. a device identifier that
 * the bank's server has bound a long-term token to). Same input
 * always yields the same output, so the caller does not have to
 * persist the slot separately alongside the long-term token.
 */
interface ISha256Prefix16Bootstrap {
  readonly kind: 'sha256-prefix-16';
  /** Creds field whose UTF-8 bytes are fed into the SHA-256 digest. */
  readonly from: string;
}

/**
 * JWT-claim bootstrap — decodes the JWT in another creds field and
 * extracts a string-valued claim via a dotted path inside the payload.
 * Required by banks whose post-login API calls embed a user-identifier
 * claim (e.g. PayBox's `pl.uId`) in the body, since warm-start skips
 * the login step that would otherwise extract that claim into carry.
 */
interface IJwtClaimBootstrap {
  readonly kind: 'jwt-claim';
  /** Creds field carrying the JWT (three base64url segments). */
  readonly from: string;
  /** Dotted path into the decoded payload (e.g. `pl.uId`). */
  readonly claim: string;
  /**
   * When true, a missing/empty source field returns `succeed('')`
   * instead of failing the bootstrap. Use this when the same carry
   * slot is also filled by a later login step's `extractsToCarry`
   * — the cold path leaves the slot empty until the login response
   * fills it, while the warm path (skipping the login steps via
   * `warmStart.fromStepIndex`) extracts the claim up-front.
   */
  readonly optional?: boolean;
}

/**
 * Bootstrap-kind union — closed set of generators the mediator runs
 * when a `seedCarryFromCreds` entry's creds value is absent. Stays
 * data-only by keeping the producer logic inside the mediator rather
 * than letting banks pass callbacks.
 */
type SeedCarryBootstrapKind = IRandomHex16Bootstrap | ISha256Prefix16Bootstrap | IJwtClaimBootstrap;

/**
 * Seed-carry source spec — names the creds field to mirror into
 * carry and (optionally) a bootstrap generator to run when the creds
 * field is absent or empty. Banks whose first-cold-run state the
 * user shouldn't have to supply (e.g. `deviceId16Hex`-style
 * per-install identifiers) opt into the bootstrap variant.
 */
interface ISeedCarrySource {
  readonly field: string;
  readonly bootstrap?: SeedCarryBootstrapKind;
}

/**
 * One-time carry-slot derivation, applied at flow init.
 *
 * Resolves each part against the partial scope (creds + secrets +
 * carry seeded so far), coerces to UTF-8 string, joins with optional
 * separator, truncates to `truncateBytes`, deposits as a string into
 * `carry[into]`. Banks declare derivations like an OTP-encryption key
 * (`deviceId + '|' + pinSuffix`, truncated to 32 bytes) without any
 * bank-specific code in the mediator.
 */
interface IDerivedCarry {
  readonly into: string;
  readonly parts: readonly RefToken[];
  readonly separator?: string;
  readonly truncateBytes?: number;
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
