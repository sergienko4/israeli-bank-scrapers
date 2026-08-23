/**
 * CAP REGIME TABLE — the cap expectation that lives OUTSIDE `eslint.config.mjs`.
 *
 * <p>`eslint.config.mjs` repeatedly uses a grandfather-then-tighten shape: a
 * broad block relaxes a whole tree, and a LATER block pins a drained sub-tree
 * back to the canonical cap. Flat config is last-wins, so deleting a tightening
 * block does not merely lose a check — it silently relaxes shipped production
 * code.
 *
 * <p>No check derived only from the current `eslint.config.mjs` can catch that,
 * because the expectation disappears together with the deleted declaration. So
 * the expectation is restated here, independently, and the gate asserts the two
 * agree EXACTLY for every production file.
 *
 * <p>Exact equality is deliberate in both directions. A looser resolved cap is a
 * regression. A tighter one means a tree was drained without updating this
 * table, which `eslint-rules-guidlines.md` §1 requires in the same PR.
 *
 * <p>An entry is either a recursive directory prefix or an exact file path, and
 * the LONGEST match wins. That is this table's OWN policy — the most specific
 * statement about a path governs it — and is deliberately NOT a model of how
 * `eslint.config.mjs` resolves. Flat config is ordered: a LATER block wins even
 * when it is BROADER, so a broad grandfather placed after a narrow tightening
 * silently overrides it. Because the two rules differ, the table must record
 * what each tree ACTUALLY resolves to, never what a config block appears to
 * declare. Any divergence surfaces as a loud mismatch rather than a silent
 * pass, which is precisely the signal this gate exists to give. A path with no
 * matching entry must resolve to the canonical CLEAN_CODE.md cap.
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

/** Canonical caps from CLEAN_CODE.md — the default for every production tree. */
export const CANONICAL_CAPS: Readonly<Record<string, number>> = {
  'max-lines': 150,
  'max-lines-per-function': 10,
  complexity: 10,
  '@typescript-eslint/max-params': 3,
};

const LEGACY_FILE_CAP = 'Legacy non-Pipeline tree; drained by its own phase, not this table.';
const MEDIATOR_FILE_OFF = 'Mediator grandfather: file cap off pending a drain phase.';
const STRATEGY_FILE_OFF = 'Strategy grandfather: file cap off pending a drain phase.';
const PIPELINE_FN_DEFAULT = 'Pipeline default of 15 LoC per function, not yet drained to 10.';
const DRAINED_FILE_PIN = 'Drained file pinned back to the canonical file cap.';
const DRAINED_FN_PIN = 'Drained file pinned back to the canonical function cap.';

/** File-size expectations that deviate from the canonical `max-lines: 150`. */
const MAX_LINES_OVERRIDES: readonly ICapOverride[] = [
  { prefix: 'src/Common', cap: 300, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/Base', cap: 300, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/Behatsdaa', cap: 300, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/BeyahadBishvilha', cap: 300, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/Mizrahi', cap: 300, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/Registry', cap: 300, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/Pipeline/Types', cap: 'off', reason: MEDIATOR_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Mediator/Completion', cap: 'off', reason: MEDIATOR_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Mediator/Elements', cap: 'off', reason: MEDIATOR_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Mediator/Form', cap: 'off', reason: MEDIATOR_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Mediator/Init', cap: 'off', reason: MEDIATOR_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Strategy/Fetch', cap: 'off', reason: STRATEGY_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Strategy/Scrape', cap: 'off', reason: STRATEGY_FILE_OFF },
  // TIGHTENINGS — each pins a drained sub-tree back to canonical. Deleting the
  // block behind one of these relaxes shipped code, which is what this gate
  // exists to catch, so each must stay pinned here.
  {
    prefix: 'src/Scrapers/Pipeline/Types/PiiRedactor',
    cap: 150,
    reason: 'Drained sub-tree pinned back to the canonical file cap.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Mediator/Init/TransportProbe',
    cap: 150,
    reason: 'Drained sub-tree pinned back to the canonical file cap.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/Account',
    cap: 150,
    reason: 'Drained sub-tree pinned back to the canonical file cap.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/Executor',
    cap: 150,
    reason: 'Drained sub-tree pinned back to the canonical file cap.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeData',
    cap: 150,
    reason: 'Drained sub-tree pinned back to the canonical file cap.',
  },
  // FILENAME-SCOPED ENTRIES — `eslint.config.mjs` pins these individual files
  // beside a differently-capped sibling directory. They are why the audit walks
  // files rather than one representative per directory.
  {
    prefix: 'src/Scrapers/Pipeline/Mediator/Init/NavigationTransportProbe.ts',
    cap: 150,
    reason: DRAINED_FILE_PIN,
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeExecutor.ts',
    cap: 150,
    reason: DRAINED_FILE_PIN,
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeDataActions.ts',
    cap: 150,
    reason: DRAINED_FILE_PIN,
  },
  {
    prefix: 'src/Scrapers/Pipeline/Phases/Base/BasePhase.ts',
    cap: 'off',
    reason: 'Template Method base class; file cap off pending a drain phase.',
  },
];

/** Function-size expectations that deviate from the canonical `max-lines-per-function: 10`. */
const MAX_LINES_PER_FUNCTION_OVERRIDES: readonly ICapOverride[] = [
  { prefix: 'src/Common', cap: 20, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/Base', cap: 20, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/Behatsdaa', cap: 20, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/BeyahadBishvilha', cap: 20, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/Mizrahi', cap: 20, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/Registry', cap: 20, reason: LEGACY_FILE_CAP },
  { prefix: 'src/Scrapers/Pipeline/Banks', cap: 15, reason: PIPELINE_FN_DEFAULT },
  { prefix: 'src/Scrapers/Pipeline/Core', cap: 15, reason: PIPELINE_FN_DEFAULT },
  { prefix: 'src/Scrapers/Pipeline/Interceptors', cap: 15, reason: PIPELINE_FN_DEFAULT },
  { prefix: 'src/Scrapers/Pipeline/Phases', cap: 15, reason: PIPELINE_FN_DEFAULT },
  { prefix: 'src/Scrapers/Pipeline/Registry/Config', cap: 15, reason: PIPELINE_FN_DEFAULT },
  { prefix: 'src/Scrapers/Pipeline/Registry/WK', cap: 15, reason: PIPELINE_FN_DEFAULT },
  {
    prefix: 'src/Scrapers/Pipeline/Types',
    cap: 30,
    reason: 'Type-heavy tree; drained separately.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Mediator/Elements',
    cap: 20,
    reason: 'Browser-interaction grandfather pending a drain phase.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Mediator/Form',
    cap: 20,
    reason: 'Browser-interaction grandfather pending a drain phase.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Fetch',
    cap: 40,
    reason: 'Strategy grandfather pending a drain phase.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape',
    cap: 40,
    reason: 'Strategy grandfather pending a drain phase.',
  },
  // TIGHTENINGS — see the note in MAX_LINES_OVERRIDES.
  {
    prefix: 'src/Scrapers/Pipeline/Types/PiiRedactor',
    cap: 10,
    reason: 'Drained sub-tree pinned back to the canonical function cap.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Mediator/Form/Actions',
    cap: 10,
    reason: 'Drained sub-tree pinned back to the canonical function cap.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Mediator/Form/Anchor',
    cap: 10,
    reason: 'Drained sub-tree pinned back to the canonical function cap.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Mediator/Form/ErrorDiscovery',
    cap: 10,
    reason: 'Drained sub-tree pinned back to the canonical function cap.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/Executor',
    cap: 10,
    reason: 'Drained sub-tree pinned back to the canonical function cap.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeData',
    cap: 10,
    reason: 'Drained sub-tree pinned back to the canonical function cap.',
  },
  {
    prefix: 'src/Scrapers/Pipeline/Types/Domain',
    cap: 10,
    reason: 'Type-only tree re-tightened after §19.2 broadened it to 30.',
  },
  // FILENAME-SCOPED ENTRIES — see the note in MAX_LINES_OVERRIDES.
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeExecutor.ts',
    cap: 10,
    reason: DRAINED_FN_PIN,
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeDataActions.ts',
    cap: 10,
    reason: DRAINED_FN_PIN,
  },
];

/**
 * Per-rule override lists. A rule absent from this map has no exceptions at
 * all: every production file must resolve it to the canonical cap.
 */
export const CAP_OVERRIDES: Readonly<Record<string, readonly ICapOverride[]>> = {
  'max-lines': MAX_LINES_OVERRIDES,
  'max-lines-per-function': MAX_LINES_PER_FUNCTION_OVERRIDES,
  complexity: [],
  '@typescript-eslint/max-params': [],
};

/**
 * Production roots the regime audit walks.
 *
 * Canaries are excluded because they hold deliberate violations. Top-level
 * `src/*.ts` is left to the §3 cluster row, whose representative is `src/index.ts`.
 */
export const PRODUCTION_ROOTS: readonly string[] = ['src/Common', 'src/Scrapers'];

/** Directory name that holds deliberate rule violations, so it is never audited. */
export const CANARY_DIR = 'EslintCanaries';

/**
 * Directory names that carry a non-production cap regime, so they are skipped.
 *
 * `eslint.config.mjs:900` relaxes `max-lines-per-function` to `off` and
 * `max-lines` to 600 for `**\/mocks/**\/*.ts`. Such a directory is not
 * production code, so auditing it against the production table would be wrong.
 */
export const NON_PRODUCTION_DIRS: readonly string[] = [CANARY_DIR, 'mocks'];

/**
 * File suffixes that carry a non-production cap regime, so they are skipped.
 *
 * The same `eslint.config.mjs:900` block relaxes those two caps for
 * `src/**\/*.test.ts` and `src/**\/*.spec.ts`. No such file exists under
 * {@link PRODUCTION_ROOTS} today, so this is a guard against a future one
 * being audited against the production table it does not belong to.
 *
 * `.d.ts` is deliberately NOT listed. ESLint applies the production caps to
 * declaration files like any other source, and `max-lines` binds even without
 * function bodies, so excluding them would leave an unaudited category.
 */
export const NON_PRODUCTION_SUFFIXES: readonly string[] = ['.test.ts', '.spec.ts'];
