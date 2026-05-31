/**
 * EnvelopeTypes — request/response envelope, fingerprint, jwt-claims,
 * auth-header and pre-step hook concern slice of the API-DIRECT-CALL
 * config contract.
 *
 * Depends on TemplateTypes (`JsonValueTemplate` referenced by
 * IFingerprintConfig) and SignerTypes (`ICryptoFieldConfig` referenced
 * by IPreStepHook). Higher-level sub-modules (FlowTypes via IPreStepHook,
 * ApiDirectCallConfig via fingerprint / jwtClaims / authScheme / probe)
 * compose from here.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

import type { WKQueryOperation } from '../../../Registry/WK/QueriesWK.js';
import type { WKUrlGroup } from '../../../Registry/WK/UrlsWK.js';
import type { ICryptoFieldConfig } from './SignerTypes.js';
import type { JsonValueTemplate } from './TemplateTypes.js';

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
 * Post-auth probe configuration — strict XOR: EXACTLY ONE of
 * `queryTag` (GraphQL via `bus.apiQuery`) or `urlTag` (REST via
 * `bus.apiGet`). Using `?: never` on the opposite arm of each union
 * variant prevents the silently-accepted both-at-once shape
 * (`{ queryTag, urlTag }`) AND the empty-discriminator shape (`{}`).
 *
 * <p>Phase 8.5c / Commit T3 — closes PR #279 CR F3. The earlier
 * shape made both fields optional on a single interface, so the
 * runtime preference logic at `ApiDirectCallActions.runProbe`
 * (queryTag preferred over urlTag) was a hidden contract the type
 * system did not enforce. Tests that intentionally exercise the
 * runtime "missing discriminator" safety net must reach the
 * unrepresentable shape via a cast through `unknown`.</p>
 */
type IProbeConfig =
  | { readonly queryTag: WKQueryOperation; readonly urlTag?: never }
  | { readonly urlTag: WKUrlGroup; readonly queryTag?: never };

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

export type { AuthScheme, IFingerprintConfig, IJwtClaimsConfig, IPreStepHook, IProbeConfig };
