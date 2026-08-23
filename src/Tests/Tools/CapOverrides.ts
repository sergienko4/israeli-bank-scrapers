/**
 * CAP OVERRIDES — every production path whose cap deliberately deviates.
 *
 * <p>A rule absent from {@link CAP_OVERRIDES}, or a path matching no entry, must
 * resolve to the canonical CLEAN_CODE.md cap. The policy these lists implement —
 * why the expectation lives outside `eslint.config.mjs`, and how entries are
 * matched — is documented in `CapRegimeTable.ts`.
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

const LEGACY_TREE_CAP = 'Legacy non-Pipeline tree; drained by its own phase, not this table.';
const TYPES_FILE_OFF = 'Types grandfather: file cap off pending a drain phase.';
const MEDIATOR_FILE_OFF = 'Mediator grandfather: file cap off pending a drain phase.';
const STRATEGY_FILE_OFF = 'Strategy grandfather: file cap off pending a drain phase.';
const PIPELINE_FN_DEFAULT = 'Pipeline default of 15 LoC per function, not yet drained to 10.';
const DRAINED_FILE_PIN = 'Drained file pinned back to the canonical file cap.';
const DRAINED_FN_PIN = 'Drained file pinned back to the canonical function cap.';
const DRAINED_TREE_FILE_PIN = 'Drained sub-tree pinned back to the canonical file cap.';
const DRAINED_TREE_FN_PIN = 'Drained sub-tree pinned back to the canonical function cap.';

/** File-size expectations that deviate from the canonical `max-lines: 150`. */
const MAX_LINES_OVERRIDES: readonly ICapOverride[] = [
  { prefix: 'src/Common', cap: 300, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/Base', cap: 300, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/Behatsdaa', cap: 300, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/BeyahadBishvilha', cap: 300, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/Mizrahi', cap: 300, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/Registry', cap: 300, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/Pipeline/Types', cap: 'off', reason: TYPES_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Mediator/Completion', cap: 'off', reason: MEDIATOR_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Mediator/Elements', cap: 'off', reason: MEDIATOR_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Mediator/Form', cap: 'off', reason: MEDIATOR_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Mediator/Init', cap: 'off', reason: MEDIATOR_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Strategy/Fetch', cap: 'off', reason: STRATEGY_FILE_OFF },
  { prefix: 'src/Scrapers/Pipeline/Strategy/Scrape', cap: 'off', reason: STRATEGY_FILE_OFF },
  // TIGHTENINGS — each pins a drained sub-tree back to canonical. Deleting the
  // block behind one of these relaxes shipped code, which is what this gate
  // exists to catch, so each must stay pinned here.
  { prefix: 'src/Scrapers/Pipeline/Types/PiiRedactor', cap: 150, reason: DRAINED_TREE_FILE_PIN },
  {
    prefix: 'src/Scrapers/Pipeline/Mediator/Init/TransportProbe',
    cap: 150,
    reason: DRAINED_TREE_FILE_PIN,
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/Account',
    cap: 150,
    reason: DRAINED_TREE_FILE_PIN,
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/Executor',
    cap: 150,
    reason: DRAINED_TREE_FILE_PIN,
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeData',
    cap: 150,
    reason: DRAINED_TREE_FILE_PIN,
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
  { prefix: 'src/Common', cap: 20, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/Base', cap: 20, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/Behatsdaa', cap: 20, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/BeyahadBishvilha', cap: 20, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/Mizrahi', cap: 20, reason: LEGACY_TREE_CAP },
  { prefix: 'src/Scrapers/Registry', cap: 20, reason: LEGACY_TREE_CAP },
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
  { prefix: 'src/Scrapers/Pipeline/Types/PiiRedactor', cap: 10, reason: DRAINED_TREE_FN_PIN },
  { prefix: 'src/Scrapers/Pipeline/Mediator/Form/Actions', cap: 10, reason: DRAINED_TREE_FN_PIN },
  { prefix: 'src/Scrapers/Pipeline/Mediator/Form/Anchor', cap: 10, reason: DRAINED_TREE_FN_PIN },
  {
    prefix: 'src/Scrapers/Pipeline/Mediator/Form/ErrorDiscovery',
    cap: 10,
    reason: DRAINED_TREE_FN_PIN,
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/Executor',
    cap: 10,
    reason: DRAINED_TREE_FN_PIN,
  },
  {
    prefix: 'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeData',
    cap: 10,
    reason: DRAINED_TREE_FN_PIN,
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
