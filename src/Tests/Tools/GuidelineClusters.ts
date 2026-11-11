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
 * Every cluster holds the universal canonical caps with zero deferrals:
 *   • `max-lines`: 150
 *   • `max-lines-per-function`: 10
 *   • `complexity`: 10
 *   • `@typescript-eslint/max-params`: 3
 * Per-cluster overrides are allowed to be STRICTER but never laxer.
 */
export const PIPELINE_CLUSTERS: readonly IClusterExpectations[] = [
  {
    clusterName: 'Main Source Strict (§3)',
    representativeFile: 'src/index.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Pipeline Phases regime (§6)',
    representativeFile: 'src/Scrapers/Pipeline/Phases/ApiDirectCall/ApiDirectCallPhase.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
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
    representativeFile: 'src/Scrapers/Pipeline/Mediator/Network/FetchConfig.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Scrape (§12)',
    representativeFile: 'src/Scrapers/Pipeline/Mediator/Scrape/TxnDedup.ts',
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
    representativeFile: 'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/Base64Paging.ts',
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
    clusterName: 'Strategy Fetch (§6/§19)',
    representativeFile: 'src/Scrapers/Pipeline/Strategy/Fetch/CappedInvoke.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
  {
    clusterName: 'Core (§6/§19)',
    representativeFile: 'src/Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.ts',
    expectations: [
      { ruleId: 'max-lines', maxAllowed: 150 },
      { ruleId: 'max-lines-per-function', maxAllowed: 10 },
      { ruleId: 'complexity', maxAllowed: 10 },
      { ruleId: '@typescript-eslint/max-params', maxAllowed: 3 },
    ],
  },
];
