/**
 * ScrapeAutoMapper — pure re-export shim. Every concern lives in
 * a focused sub-module under `Mediator/Scrape/<Bucket>/`; this
 * file exists so the historic import path
 * `Mediator/Scrape/ScrapeAutoMapper.js` keeps working across the
 * codebase + tests without a sweeping rename.
 *
 * Split landed in Phase 5 (pipeline-decoupling-master-2026-05-28).
 * NetworkDiscovery's Phase 4 split is the precedent template.
 */

export type {
  ITxnEndpoint as TxnEndpoint,
  ITxnFieldMap as TxnFieldMap,
} from '../../Types/PipelineContext.js';
export {
  extractAccountIds,
  extractAccountRecords,
  extractAllContainers,
  isUsableIdentifier,
} from './AccountExtractor/AccountExtractor.js';
export { findAllFieldValues, findFieldValue, matchField } from './BfsFieldSearch/BfsFieldSearch.js';
export { parseAutoDate } from './Coercion/Coercion.js';
export {
  extractTransactions,
  extractTransactionsForCard,
} from './ContainerPicker/ContainerPicker.js';
export { scopedTxnBalanceAliases } from './EndpointResolver/EndpointFieldMap.js';
export { default as resolveTxnEndpoint } from './EndpointResolver/EndpointResolver.js';
export { default as findFirstArray } from './FieldHunt/LifoCrawl.js';
export type { IMonthChunk } from './ScrapeReplayAction.js';
export {
  buildMonthBody,
  generateMonthChunks,
  isMonthlyEndpoint,
  isRangeIterable,
  replaceField,
} from './ScrapeReplayAction.js';
export { autoMapTransaction } from './TxnMapper/TxnMapper.js';
