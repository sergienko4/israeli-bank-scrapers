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
import type { JsonValueTemplate, RefToken } from './TemplateTypes.js';

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

/**
 * Authorization scheme: "raw" sends the JWT verbatim, "bearer" prefixes the
 * standard bearer word, "prefixed" prefixes `authPrefix`, and "none" sends no
 * header because the session is a cookie (needs `headless.sessionCookies`).
 */
type AuthScheme = 'raw' | 'bearer' | 'prefixed' | 'none';

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
/**
 * How often a `preHook` acquires its credential during one login flow.
 *
 * <p>`per-flow` (the default) acquires once and reuses the value across every
 * step awaiting the same credential field — correct when the bank delivers a
 * single secret that several steps must each submit. `per-step` re-acquires
 * for every step, for a bank that genuinely issues a distinct secret per step.
 */
type PreHookReuse = 'per-flow' | 'per-step';

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
  /**
   * Optional reuse mode. Defaults to `'per-flow'`: the credential is
   * acquired once per login and reused by every step awaiting the same
   * field, so a one-time secret is never requested twice.
   */
  readonly reuse?: PreHookReuse;
  /**
   * Optional carry slot whose text is passed to the callback as its hint
   * (e.g. the masked phone the code went to); `''` when unset, absent or
   * not text. Never logged.
   */
  readonly hintFrom?: `carry.${string}`;
  /**
   * Optional refs that must resolve before the callback is asked.
   * Cookie refs see existing jar values and the step's own pending setCookies.
   * Pending cookies are not committed before validation; misses retain the
   * resolver's own failure message.
   */
  readonly requires?: readonly RefToken[];
  /**
   * Optional anchored regex the callback's value must match; a mismatch
   * fails InvalidOtp before the step's request is sent.
   */
  readonly valuePattern?: string;
  /**
   * Optional carry slot holding the exact OTP length the bank stated, an
   * integer 4..10. When the slot is set, the value must be exactly that
   * many ASCII digits, else the step fails InvalidOtp before its request. An
   * absent slot leaves `valuePattern` alone; any other value fails the step
   * before the callback is asked.
   */
  readonly valueLengthRef?: `carry.${string}`;
}

export type {
  AuthScheme,
  IFingerprintConfig,
  IJwtClaimsConfig,
  IPreStepHook,
  IProbeConfig,
  PreHookReuse,
};
