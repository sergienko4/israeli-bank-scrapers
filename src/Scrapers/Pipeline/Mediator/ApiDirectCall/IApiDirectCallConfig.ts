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

/** Exhaustive flow-kind discriminator (spec.txt §B.3). */
type FlowKind = 'sms-otp' | 'stored-jwt' | 'bearer-static';

/** Supported crypto algorithm tags consumed by GenericCryptoSigner. */
type SignerAlgorithm = 'ECDSA-P256' | 'RSA-2048' | 'AES-CBC-PKCS7';

/** Asymmetric subset — discriminator for {@link IAsymmetricSignerConfig}. */
type AsymmetricSignerAlgorithm = 'ECDSA-P256' | 'RSA-2048';

/** Supported signature-encoding tags (DER for legacy, JOSE for modern). */
type SignerEncoding = 'DER' | 'JOSE';

/** Canonical-string parts — ordered by ICanonicalStringConfig.parts. */
type CanonicalPart = 'pathAndQuery' | 'clientVersion' | 'bodyJson' | 'tsMs' | 'deviceId';

/** Step identifiers in the sms-otp flow. */
type StepName = 'bind' | 'assertPassword' | 'assertOtp' | 'getIdToken' | 'sessionToken';

/** RefToken — interpolation tokens in IBodyTemplate. */
type RefToken =
  | 'fingerprint'
  | 'uuid'
  | 'now'
  | 'nowMs'
  | 'keypair.ec.publicKeyBase64'
  | 'keypair.rsa.publicKeyBase64'
  | `carry.${string}`
  | `creds.${string}`
  | `config.${string}`;

/** Named selector map — values are RFC-6901 pointers like `/data/challenge`. */
type IEnvelopeSelectors = Readonly<Record<string, string>>;

/** Canonical-string assembly config — consumed by GenericCanonicalStringBuilder. */
interface ICanonicalStringConfig {
  readonly parts: readonly CanonicalPart[];
  readonly separator: string;
  readonly escapeFrom: string;
  readonly escapeTo: string;
  readonly sortQueryParams: boolean;
  readonly clientVersion: string;
}

/**
 * Asymmetric (ECDSA / RSA) signer variant — header-attached signature.
 *
 * Existing banks (Pepper, OneZero) use this shape: the signature is
 * computed over a canonical string + attached as a header value
 * `data:<b64>;key-id:<hex>;scheme:<n>`.
 */
interface IAsymmetricSignerConfig {
  readonly algorithm: AsymmetricSignerAlgorithm;
  readonly encoding: SignerEncoding;
  readonly headerName: string;
  readonly schemeTag: number;
  readonly canonical: ICanonicalStringConfig;
}

/**
 * Symmetric AES-CBC-PKCS7 signer variant — body-pointer-attached
 * signature. The signature is written into the outgoing JSON body at
 * a configured RFC-6901 pointer (`/signature` for class-z; `/auth/signature`
 * for class-y post-login envelopes). The optional postfix lets banks
 * whose servers expect a trailing newline append one.
 *
 * `ivCarrySlot` names the carry slot the runner overwrites with a
 * fresh 16-byte random hex string at each step entry; the body
 * template references the same slot via `$ref: 'carry.<slot>'` so the
 * hydrated body and the signer observe the same IV bytes.
 */
interface IAesSignerConfig {
  readonly algorithm: 'AES-CBC-PKCS7';
  readonly keyRef: `config.${string}`;
  readonly ivStrategy: 'random-16';
  readonly ivCarrySlot: string;
  readonly canonical: ICanonicalStringConfig;
  readonly bodySignatureField: string;
  readonly bodyIvField?: string;
  readonly outputPostfix?: string;
}

/** Bank crypto configuration — discriminated by `algorithm`. */
type ISignerConfig = IAsymmetricSignerConfig | IAesSignerConfig;

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
 * Optional crypto-field config — after the preHook deposits a creds
 * value into carry, encrypt it via the bank's AES primitive and write
 * the ciphertext into the outgoing body at a JSON pointer, then scrub
 * the plaintext from carry. Used by PIN / OTP-encrypting banks whose
 * login flow encrypts a PIN / OTP into a body pointer separately from
 * the request-body signature.
 */
interface ICryptoFieldConfig {
  /**
   * Key reference — resolved against `config.<dotted.path>` or
   * `carry.<slot>`. The resulting key bytes are a step-time artifact.
   */
  readonly keyRef: `config.${string}` | `carry.${string}`;
  /** IV reference — typically a 32-hex carry slot like `carry.pinIv1Hex`. */
  readonly ivRef: `carry.${string}`;
  /** Optional trailing-postfix string (e.g. `\n` when the server demands one). */
  readonly outputPostfix?: string;
  /** RFC-6901 pointer into the outbound body (e.g. `/pin`). */
  readonly writeTo: string;
  /** Name of the carry slot to redact post-encryption. */
  readonly scrubFromCarry: string;
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

/** Recursive body template — JsonValueTemplate with $literal / $ref nodes. */
type JsonValueTemplate =
  | { readonly $literal: unknown }
  | { readonly $ref: RefToken }
  | Readonly<Record<string, unknown>>;

/** Body template wrapper — shape is recursive JsonValueTemplate. */
interface IBodyTemplate {
  readonly shape: JsonValueTemplate;
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
