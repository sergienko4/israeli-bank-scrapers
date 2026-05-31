/**
 * SCRAPE phase Mediator actions — re-export shim (Phase 8.5b C5).
 *
 * <p>All composer fns (executeForensicPre / executeMatrixLoop /
 * executeValidateResults / executeStampAccounts) + the DIRECT-path
 * helpers (executeDirectDiscovery, collectStorageSafe) + the
 * pre-discovery readers consumed by FrozenScrapeAction live under
 * `ScrapePhase/` sub-modules after C4 (leaves) and C5 (composers).
 *
 * <p>This file exists solely to preserve the public import path
 * `Mediator/Scrape/ScrapePhaseActions.js` used by ScrapeMediator
 * + FrozenScrapeAction. After C6 it can be deleted entirely once
 * both consumers update to the barrel path.
 */

export { EMPTY_TXN_ENDPOINT } from '../../Strategy/Scrape/ScrapeTypes.js';
export { EMPTY_TXN_HARVEST } from '../../Types/PipelineContext.js';
export {
  executeForensicPre,
  executeMatrixLoop,
  executeStampAccounts,
  executeValidateResults,
  readBillingCycleCatalog,
  readDashboardTxnHarvest,
  readDateWindowParams,
  readDedupKeyFields,
  readPreDiscoveredTxn,
} from './ScrapePhase/index.js';
