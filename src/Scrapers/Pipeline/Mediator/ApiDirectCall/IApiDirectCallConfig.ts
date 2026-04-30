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
type SignerAlgorithm = 'ECDSA-P256' | 'RSA-2048';

/** Supported signature-encoding tags (DER for legacy, JOSE for modern). */
type SignerEncoding = 'DER' | 'JOSE';

/** Canonical-string parts — ordered by ICanonicalStringConfig.parts. */
type CanonicalPart = 'pathAndQuery' | 'clientVersion' | 'bodyJson';

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

/** Bank crypto configuration — optional per flow. */
interface ISignerConfig {
  readonly algorithm: SignerAlgorithm;
  readonly encoding: SignerEncoding;
  readonly headerName: string;
  readonly schemeTag: number;
  readonly canonical: ICanonicalStringConfig;
}

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

/** Top-level config literal — placed into PIPELINE_BANK_CONFIG[bank].apiDirectCall. */
interface IApiDirectCallConfig {
  readonly flow: FlowKind;
  readonly steps: readonly IStepConfig[];
  readonly envelope: IEnvelopeSelectors;
  readonly signer?: ISignerConfig;
  readonly fingerprint?: IFingerprintConfig;
  readonly jwtClaims?: IJwtClaimsConfig;
  readonly probe: IProbeConfig;
  readonly staticHeaders?: Readonly<Record<string, string>>;
  /** How to format the final Authorization header value (default 'raw'). */
  readonly authScheme?: AuthScheme;
  /** Optional warm-start shortcut — see IWarmStartConfig for semantics. */
  readonly warmStart?: IWarmStartConfig;
}

export type {
  AuthScheme,
  CanonicalPart,
  FlowKind,
  IApiDirectCallConfig,
  IBodyTemplate,
  ICanonicalStringConfig,
  IEnvelopeSelectors,
  IFingerprintConfig,
  IJwtClaimsConfig,
  IPreStepHook,
  IProbeConfig,
  ISignerConfig,
  IStepConfig,
  IWarmStartConfig,
  JsonValueTemplate,
  RefToken,
  SignerAlgorithm,
  SignerEncoding,
  StepName,
};
