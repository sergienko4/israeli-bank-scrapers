// Canary fixture for the PR-261-V5 rule (eslint.config.mjs § "PR #261
// REVIEW VALIDATORS" / CR-P3 selector). MUST exhibit the forbidden
// `.success === true` pattern so the canary harness sees a non-zero
// error count. Removing this file would let the V5 selector decay
// silently.
//
// Applicable guidelines:
//   - design-patterns-guidlines.md "Result Pattern": use Procedure<T>
//     helpers (isOk / succeed / fail), not raw discriminator checks.
//   - PR #261 CodeRabbit finding CR8 (PhoneFormatter.ts:102) — the
//     original violation that motivated the canary.

interface ICanaryProcedure {
  readonly success: boolean;
}

/**
 * Intentionally-forbidden discriminator check — exists ONLY so the
 * V5 ESLint selector keeps firing on every run.
 * @param result - Synthetic Procedure-like value.
 * @returns Always `true`.
 */
export function preferIsOkHelperCanary(result: ICanaryProcedure): boolean {
  // eslint canary fixture — forbidden by no-restricted-syntax CR-P3.
  return result.success === true;
}
