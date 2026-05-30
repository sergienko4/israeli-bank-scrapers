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

export type {
  IDerivedCarry,
  IJwtClaimBootstrap,
  IRandomHex16Bootstrap,
  ISeedCarrySource,
  ISha256Prefix16Bootstrap,
  IWarmStartConfig,
  SeedCarryBootstrapKind,
};
