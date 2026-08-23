/**
 * GUIDELINE CLUSTERS — the documented Pipeline clusters and their expected caps.
 *
 * <p>Each entry names a cluster from CLEAN_CODE.md, one representative file, and
 * the caps that file's resolved config must hold. This is the SAMPLE half of the
 * gate; the exhaustive per-file half lives in `CapRegimeTable.ts` and
 * `CapOverrides.ts`.
 */

/** A single per-rule cap that must hold for the cluster's resolved config. */
export interface IRuleExpectation {
  readonly ruleId: string;
  readonly maxAllowed: number;
}

/** Expected rule settings per Pipeline cluster (sourced from CLEAN_CODE.md). */
export interface IClusterExpectations {
  readonly clusterName: string;
  readonly representativeFile: string;
  readonly expectations: readonly IRuleExpectation[];
  /**
   * Rules this cluster does not yet satisfy, named individually.
   *
   * Deferring a whole cluster surrenders every OTHER rule in it: a cluster
   * held back for one un-drained cap stops being checked for file size,
   * complexity and parameter count too, so a scoped declaration can be
   * deleted there unnoticed. Naming the exception keeps the rest enforced.
   * Source-of-truth for a deferral is the per-section "STATUS" column of
   * the CLEAN_CODE.md per-cluster table.
   */
  readonly deferredRules?: readonly string[];
}

/**
 * Canonical caps from CLEAN_CODE.md (the single source of truth).
 *   • Every drained cluster (§11/§12/§12B/§13/§14) holds the
 *     canonical ≤10 LoC per function HARD CAP (post Phase 8.5a/b/c).
 *   • §3 Main Source Strict still resolves `max-lines` to 300, so that
 *     ONE rule is deferred by name; its other three caps are enforced.
 *   • §6 Pipeline Phases already resolves every cap it declares, so it
 *     is enforced outright. That is what makes deleting a per-cluster
 *     declaration fail this gate rather than pass unnoticed.
 *   • §19.1a/b/c are drained sub-trees of `Strategy/**`, which §19.1
 *     grandfathers to 40 LoC per function. Each is pinned back to the
 *     canonical 10 by a LATER block; deleting that block silently relaxes
 *     shipped code from 10 to 40. The CAP REGIME AUDIT is what turns that
 *     into a gate failure, and it does so for every such block rather than
 *     only the few named here. §19.1c pins only `max-lines`, so its
 *     per-function cap is deferred by name rather than pretended.
 * Per-cluster overrides are allowed to be STRICTER but never laxer.
 */
export const PIPELINE_CLUSTERS: readonly IClusterExpectations[] = [
  {
    clusterName: 'Main Source Strict (§3)',
    representativeFile: 'src/index.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 20 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
    deferredRules: ['max-lines'],
  },
  {
    // The §6 label is the config section, not the whole Pipeline tree: the
    // 787 production TypeScript files under `src/Scrapers/Pipeline` (863
    // total, less the 76 canaries) span eight cap regimes, and this row
    // measures only the `Phases/**` one that its representative sits in
    // (15 per function, granted by the §19.3 grandfather rather than the
    // canonical 10). The other seven regimes are covered by the per-file
    // sweep in `lint:guideline-coverage`, not by this row.
    clusterName: 'Pipeline Phases regime (§6)',
    representativeFile: 'src/Scrapers/Pipeline/Phases/AccountResolve/AccountResolvePhase.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 15 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'PiiRedactor (§13)',
    representativeFile: 'src/Scrapers/Pipeline/Types/PiiRedactor/Account.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Network (§11)',
    representativeFile: 'src/Scrapers/Pipeline/Mediator/Network/Scoring/Scoring.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Scrape (§12)',
    representativeFile: 'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeRouter.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      // §12 declares the file cap; the function cap comes from the later,
      // broader §14b.4, which drained this whole tree to canonical.
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Scrape canonical-10 sub-folders (§12B)',
    representativeFile: 'src/Scrapers/Pipeline/Mediator/Scrape/ScrapePhase/PhaseActions.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'ApiDirectCall ConfigContracts (§14)',
    representativeFile:
      'src/Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/TemplateTypes.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Strategy Scrape Executor (§19.1a)',
    representativeFile: 'src/Scrapers/Pipeline/Strategy/Scrape/Executor/Account.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Strategy Scrape ScrapeData (§19.1b)',
    representativeFile: 'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeData/ScrapeDataAssembly.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Strategy Scrape Account (§19.1c)',
    representativeFile: 'src/Scrapers/Pipeline/Strategy/Scrape/Account/AccountScrapeFirstWave.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
    deferredRules: ['max-lines-per-function'],
  },
];
