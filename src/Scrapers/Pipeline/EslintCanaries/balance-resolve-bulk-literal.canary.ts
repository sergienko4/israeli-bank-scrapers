/**
 * Canary fixture for ESLint block 8h — BALANCE-RESOLVE BULK_KEY
 * CONSTANTS: the string literal `'__BULK__'` is forbidden inside
 * `Mediator/BalanceResolve/`. Callers MUST import the named constant
 * `BULK_KEY` from `BalanceFetchPlanner.ts` so the sentinel stays in one
 * place and can be renamed atomically (CR #264 finding #7 — Major).
 *
 * This file deliberately violates the rule so the eslint canary
 * harness reports a non-zero error count.
 */

/**
 * Forbidden pattern: hardcoded '__BULK__' literal in BALANCE-RESOLVE
 * code instead of the named BULK_KEY constant.
 *
 * @returns Sentinel string (forbidden literal).
 */
export function bulkSentinel(): string {
  return '__BULK__';
}
