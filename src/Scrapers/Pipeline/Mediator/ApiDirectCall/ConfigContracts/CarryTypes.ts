/**
 * CarryTypes — flow-init carry & warm-start concern slice of the
 * API-DIRECT-CALL config contract.
 *
 * Depends on TemplateTypes (`RefToken` references in IDerivedCarry).
 * Carries the closed set of carry-bootstrap kinds + per-variant
 * configuration shapes consumed by Flow/FlowInitCarry. Higher-level
 * sub-modules (ApiDirectCallConfig via seedCarryFromCreds / derivedCarry /
 * warmStart) compose from here.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

import type { RefToken } from './TemplateTypes.js';

/** What every warm-start kind reads: the stored token and where to resume. */
interface IWarmStartBase {
  readonly credsField: string;
  readonly fromStepIndex: number;
}

/**
 * Carry warm start — when creds[credsField] is populated (and
 * JWT-fresh if jwtClaims configured), SmsOtpFlow pre-seeds
 * scope.carry[carryField] with that creds value and starts iterating
 * steps from fromStepIndex. fromStepIndex === steps.length means
 * zero steps run (Pepper: stored value IS the final token). The build
 * rejects a fractional, NaN or larger index (`ApiDirectConfigRules`).
 */
interface ICarryWarmStart extends IWarmStartBase {
  /** Omitted on every carry config; the default kind. */
  readonly kind?: 'carry';
  readonly carryField: string;
  /**
   * How a stored token is judged before reuse. `'jwt'` (default) reads its
   * expiry locally through `jwtClaims`; `'bank-call'` is for a token with no
   * readable expiry, so the first warm step sent to the bank is the check;
   * `fromStepIndex` must then name a step.
   */
  readonly validation?: 'jwt' | 'bank-call';
}

/**
 * Cookie-jar warm start — for a cookie-session bank, whose stored token is
 * the session jar itself (`Flow/WarmCookieJar.ts`). The jar is imported, the
 * flow resumes at `fromStepIndex`, and that first step is the check.
 */
interface ICookieJarWarmStart extends IWarmStartBase {
  readonly kind: 'cookie-jar';
  readonly validation: 'bank-call';
  /** Provider tag encoded into the token; a token for another provider is skipped. */
  readonly provider: string;
  /** Creds field holding the account the token is bound to. */
  readonly accountField: string;
  /** Longest token imported or exported, 1–16384. */
  readonly maxTokenChars: number;
}

/**
 * Which failed warm resumes may fall back to a cold login: `any` failure, or
 * only the bank's 401/403 (`auth-rejected`, read by `isAuthRejectedFailure`),
 * so a timeout or a 5xx never starts a registration.
 */
type ColdFallback = 'any' | 'auth-rejected';

/**
 * Carry-bundle warm start — for a bank whose warm login needs several carry
 * slots (and optionally the session jar) a cold login fills. The stored token
 * (`Flow/WarmCarryBundle.ts`) restores the jar first, then seeds the listed
 * slots, and the flow resumes at `fromStepIndex`, whose step is the check.
 */
interface ICarryBundleWarmStart extends IWarmStartBase {
  readonly kind: 'carry-bundle';
  readonly validation: 'bank-call';
  /** Provider tag encoded into the token; a token for another provider is skipped. */
  readonly provider: string;
  /** Creds fields, in order, whose values the token is bound to; at least one. */
  readonly accountFields: readonly string[];
  /** Carry slots the token keeps; each one a login step fills. */
  readonly slots: readonly string[];
  /** Longest token imported or exported, 1–16384. */
  readonly maxTokenChars: number;
  /** Whether the token also keeps the session jar the login ended with. */
  readonly cookies: boolean;
  /** Which failed warm resumes may fall back to a cold login. */
  readonly coldFallback: ColdFallback;
}

/** Warm-start config — the stored token's kind decides how it is restored. */
type IWarmStartConfig = ICarryWarmStart | ICookieJarWarmStart | ICarryBundleWarmStart;

/**
 * Random 16-byte hex bootstrap — non-deterministic, fresh per process.
 * Used when the carry slot just needs a unique opaque token.
 *
 * <p>Phase 8.5c / Commit T2 — discriminator unification. The earlier
 * shape was the bare string literal `'random-hex-16'`, which forced
 * `evalBootstrap` into an if-chain (`if (bootstrap === 'random-hex-16')
 * ... else if (bootstrap.kind === …)`) and prevented an exhaustive
 * `switch`. Wrapping the parameterless variant in `{ kind }` brings
 * it inline with the two parameterised siblings + lets `assertNever`
 * lock the dispatch.</p>
 */
interface IRandomHex16Bootstrap {
  readonly kind: 'random-hex-16';
}

/**
 * Random UUID v4 bootstrap — non-deterministic, generated once per flow
 * init so every step template that reads the carry slot sees the same
 * value. Used when a bank expects a canonical UUID client-instance
 * identifier that must stay stable across the steps of one login.
 */
interface IRandomUuidBootstrap {
  readonly kind: 'random-uuid';
}

/**
 * N42 — random hex of a configured length, fresh per flow init: `bytes`
 * random bytes become twice as many hex characters, upper-case when
 * `isUpperCase` is set. Used when a bank expects a flow identifier of a
 * fixed length and case.
 */
interface IRandomHexBootstrap {
  readonly kind: 'random-hex';
  /** Random bytes to draw, an integer from 1 to 64. */
  readonly bytes: number;
  /** Upper-case hex when true, else lower-case. */
  readonly isUpperCase: boolean;
}

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
type SeedCarryBootstrapKind =
  | IRandomHex16Bootstrap
  | IRandomHexBootstrap
  | IRandomUuidBootstrap
  | ISha256Prefix16Bootstrap
  | IJwtClaimBootstrap;

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
 * separator, lower-cases the text when `transform` is `'lower'` (N60),
 * truncates to `truncateBytes`, applies the optional `op` (N45) last,
 * deposits as a string into
 * `carry[into]`. Banks declare derivations like an OTP-encryption key
 * (`deviceId + '|' + pinSuffix`, truncated to 32 bytes) without any
 * bank-specific code in the mediator.
 */
interface IDerivedCarry {
  readonly into: string;
  readonly parts: readonly RefToken[];
  readonly separator?: string;
  readonly transform?: 'lower';
  readonly truncateBytes?: number;
  readonly op?: DerivedOp;
}

/**
 * One `format` rule (N45): when the whole text matches `pattern`, the
 * value is `prefix` plus the text left-padded with `'0'` to `padStart`
 * chars.
 */
interface IFormatRule {
  readonly pattern: string;
  readonly prefix: string;
  readonly padStart?: number;
}

/** N45 `format`: the first rule whose anchored pattern matches shapes the text. */
interface IFormatOp {
  readonly kind: 'format';
  readonly rules: readonly IFormatRule[];
}

/** N45 `md5-hex`: the MD5 digest of the UTF-8 text, as lower-case hex. */
interface IMd5HexOp {
  readonly kind: 'md5-hex';
}

/** The last shaping a derivation applies to its text (N45). */
type DerivedOp = IFormatOp | IMd5HexOp;

export type {
  ColdFallback,
  DerivedOp,
  ICarryBundleWarmStart,
  ICarryWarmStart,
  ICookieJarWarmStart,
  IDerivedCarry,
  IFormatOp,
  IFormatRule,
  IJwtClaimBootstrap,
  IMd5HexOp,
  IRandomHex16Bootstrap,
  IRandomHexBootstrap,
  IRandomUuidBootstrap,
  ISeedCarrySource,
  ISha256Prefix16Bootstrap,
  IWarmStartConfig,
  SeedCarryBootstrapKind,
};
