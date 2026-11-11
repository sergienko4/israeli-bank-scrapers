/**
 * CAP OVERRIDES — per-path deviations from the canonical CLEAN_CODE.md caps.
 *
 * <p>Every production tree in `src/` now satisfies the canonical caps
 * (`max-lines: 150`, `max-lines-per-function: 10`, `complexity: 10`,
 * `@typescript-eslint/max-params: 3`), so all four override lists are empty.
 * The override table and the per-file regime gate in `CapRegimeTable.ts` +
 * `EslintCapProbe.ts` stay active so any future `eslint.config.mjs` block that
 * weakens or turns off a production cap fails closed at pre-commit.
 */

/** A resolved numeric cap, or `'off'` when the rule is disabled for the tree. */
export type TResolvedCap = number | 'off';

/** One path whose resolved cap deliberately differs from the canonical value. */
export interface ICapOverride {
  /** Repo-relative directory prefix, or an exact file path for a scoped block. */
  readonly prefix: string;
  /** The cap that path must resolve to — matched exactly, not as an upper bound. */
  readonly cap: TResolvedCap;
  /** Why this path differs, and which `eslint.config.mjs` block establishes it. */
  readonly reason: string;
}

/**
 * Per-rule override lists. Every list is empty now that all grandfather caps
 * have been drained: every production file must resolve to the canonical cap.
 */
export const CAP_OVERRIDES: Readonly<Record<string, readonly ICapOverride[]>> = {
  'max-lines': [],
  'max-lines-per-function': [],
  complexity: [],
  '@typescript-eslint/max-params': [],
};
