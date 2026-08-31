/**
 * CANARY — Scrape canonical-10 negated-condition guard (PR #281 C9 §12D).
 *
 * This file intentionally exhibits a negated ternary condition — the
 * anti-pattern flagged by Sonar `typescript:S7735` ("Unexpected negated
 * condition") TWICE in PR #281:
 *
 * <ul>
 *   <li>SQ-1 — `ScrapePhase/PhaseActions.ts` `executeStampAccounts`
 *       `if (!input.txnEndpoint.has) { … } else { … }` (early-cycle).</li>
 *   <li>C9   — `ScrapePhase/PhaseActions.ts:139` ternary
 *       `template.url !== '' ? template : undefined` (post-C8).</li>
 * </ul>
 *
 * Its presence here verifies — via `verify.sh` — that `eslint.config.mjs`
 * §12D fires on every local lint run, so the same readability anti-pattern
 * can never land in the canonical-10 sub-folders without local failure
 * first.
 *
 * <h2>Expected behavior</h2>
 *
 * Running `npx eslint --no-ignore <this-file>` MUST report at least one
 * error whose `ruleId` is exactly `no-negated-condition`. The harness in
 * `assert-canaries.cjs` matches on the declared rule id, so neither a
 * parsing error nor an unrelated rule can satisfy this canary — if §12D is
 * removed, no other diagnostic will stand in for it.
 *
 * <p>NOTE: §12B's `max-lines-per-function` cap is disabled here so the
 * cap rule does NOT pre-empt §12D. The canary's purpose is to document
 * the BANNED-PATTERN rule and act as a tripwire if §12D is ever silently
 * removed.</p>
 *
 * @canary scrape-canonical10-negated-condition
 *
 * canary-expects-rule: no-negated-condition
 */

interface ICanaryInput {
  readonly url: string;
  readonly id: string;
}

const SENTINEL = { url: '<NONE>', id: '<NONE>' } as const;

/**
 * Anti-pattern: negated ternary condition (§12D). The correct form would
 * be `input.url === '' ? SENTINEL : input` (positive-first branches).
 *
 * @param input - Candidate input.
 * @returns Input when usable, SENTINEL otherwise.
 */
function pickInputAntiPatternTernary(input: ICanaryInput): ICanaryInput {
  return input.url !== '' ? input : SENTINEL;
}

/**
 * Anti-pattern: negated if-else branches (§12D). The correct form would
 * swap the branches so the positive case comes first.
 *
 * @param input - Candidate input.
 * @returns The input id when usable, '<NONE>' otherwise.
 */
function pickInputAntiPatternIfElse(input: ICanaryInput): string {
  if (!input.id) {
    return '<NONE>';
  } else {
    return input.id;
  }
}

export { pickInputAntiPatternIfElse, pickInputAntiPatternTernary };
