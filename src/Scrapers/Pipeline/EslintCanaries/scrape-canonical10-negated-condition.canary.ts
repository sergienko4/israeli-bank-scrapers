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
 * `no-negated-condition` error. The canary harness in `verify.sh` checks
 * `errorCount > 0` — a parsing error (because canaries are excluded from
 * tsconfig) counts, so this file is guaranteed to satisfy the canary even
 * when the rule's reporting evolves.
 *
 * <p>NOTE: §12B's `max-lines-per-function` cap is disabled here so the
 * cap rule does NOT pre-empt §12D. The canary's purpose is to document
 * the BANNED-PATTERN rule and act as a tripwire if §12D is ever silently
 * removed.</p>
 *
 * @canary scrape-canonical10-negated-condition
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
// eslint-disable-next-line max-lines-per-function -- canary deliberately exhibits §12D anti-pattern; cap not the point
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
// eslint-disable-next-line max-lines-per-function -- canary deliberately exhibits §12D anti-pattern; cap not the point
function pickInputAntiPatternIfElse(input: ICanaryInput): string {
  if (!input.id) {
    return '<NONE>';
  } else {
    return input.id;
  }
}

export { pickInputAntiPatternIfElse, pickInputAntiPatternTernary };
