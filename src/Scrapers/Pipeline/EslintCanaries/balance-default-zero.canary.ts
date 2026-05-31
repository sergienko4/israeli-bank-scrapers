/**
 * Canary fixture for ESLint block 8i — BALANCE DEFAULT-ZERO
 * PROHIBITION: any expression of shape `<identifier>.balance ?? 0`
 * (or `?? null`) inside the Pipeline layer is forbidden because it
 * makes "balance unknown" indistinguishable from a real zero balance.
 * Per coding-principle-guidlines §4 DEFAULT-DENY, missing data must be
 * skipped (or surfaced as a Procedure failure), never silently
 * defaulted (CR #264 finding #5 — Major).
 *
 * This file deliberately violates the rule so the eslint canary
 * harness reports a non-zero error count.
 */

interface IFakeAccount {
  readonly balance?: number;
}

/**
 * Forbidden pattern: nullish-coalesce on a `.balance` field to a
 * numeric literal.
 *
 * @param acc - Account record.
 * @returns Resolved balance.
 */
export function silentZeroFallback(acc: IFakeAccount): number {
  return acc.balance ?? 0;
}
