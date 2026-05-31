/**
 * ScrapePhase barrel — re-exports the leaf helpers + composer
 * actions extracted from ScrapePhaseActions.ts in Phase 8.5b
 * C4 (leaves) and C5 (composers). Lets external callers import
 * from one stable surface even though the implementation lives
 * in focused sub-modules.
 */

export {
  buildTemplateForScrape,
  discoverBalanceFetchTemplate,
  EMPTY_BALANCE_TEMPLATE,
} from './BalanceTemplate.js';
export { buildPreDiag, LOG, maybeForensicPrime } from './Diag.js';
export { collectStorageSafe, executeDirectDiscovery } from './DirectActions.js';
export { decideEmptyGate, warnZeroAmounts } from './EmptyDetection.js';
export {
  BANK_ACCOUNT_ID_FIELDS,
  buildAccountIdentities,
  buildIdentitiesForScrape,
  coerceStringFieldValue,
  EMPTY_IDENTITIES,
  recordToIdentity,
} from './Identity.js';
export {
  executeForensicPre,
  executeMatrixLoop,
  executeStampAccounts,
  executeValidateResults,
} from './PhaseActions.js';
export {
  EMPTY_CATALOG,
  EMPTY_DATE_WINDOW_PARAMS,
  type IPreDiscoveredAccounts,
  readBillingCycleCatalog,
  readDashboardTxnHarvest,
  readDateWindowParams,
  readDedupKeyFields,
  readPreDiscoveredAccounts,
  readPreDiscoveredTxn,
} from './PreDiscovery.js';
