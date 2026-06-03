/**
 * ESLint canary — per-bank `describe()` duplication anti-pattern.
 *
 * Phase 7 cross-bank STRUCTURAL refactor goal: tests assert
 * **flow + contract**, not **bank**. The bank is an `it.each` input
 * row from `src/Tests/Helpers/banks.ts`'s `BANKS` constant.
 *
 * The anti-pattern this canary blocks (duplicated test bodies, one
 * per bank):
 *
 *   describe('Login.hapoalim', () => { it('logs in', ...) });
 *   describe('Login.discount', () => { it('logs in', ...) });
 *   describe('Login.max',      () => { it('logs in', ...) });
 *
 * Canonical replacement:
 *
 *   describe('Login.flow', () => {
 *     it.each(BANKS)('logs in [%s]', async bank => { ... });
 *   });
 *
 * NOT blocked (genuine bank-specific edge-case suites are valid):
 *
 *   describe('Hapoalim WAF challenge', ...)            ← bank as feature name
 *   describe('OneZero long-term token cache', ...)     ← bank as feature name
 *   describe('PayBox phone normalisation edge', ...)   ← bank as feature name
 *
 * The selector matches a literal of shape `<Word>.<bank>` (with the
 * bank token strictly lowercased to one of the 19 CompanyTypes
 * enum bank names) — so bank-as-feature-name `describe()`s that
 * start with the bank name (not `<Phase>.<bank>`) stay legal.
 *
 * Verify.sh §T1 hardening: this file MUST trigger at least one rule
 * with non-null ruleId. The rule lives in the shared
 * `RESTRICTED_SYNTAX_RULES` array in `eslint.config.mjs` (alongside
 * the existing generic-name `describe('test|run|batch|suite')`
 * restriction). The array is spread into every src TypeScript scope,
 * so this canary file is covered without needing a single-file
 * override. The 3 `describe('<Phase>.<bank>')` literals below
 * trigger 3 hits — non-null ruleId => verify.sh satisfied.
 */

declare function describe(name: string, fn: () => unknown): void;

describe('Login.hapoalim', () => {
  return { status: 'canary' };
});

describe('Dashboard.discount', () => {
  return { status: 'canary' };
});

describe('Scrape.max', () => {
  return { status: 'canary' };
});
