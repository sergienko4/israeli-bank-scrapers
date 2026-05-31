/**
 * Barrel — re-exports the public ScrapeReplay surface.
 * Preserves the historical ScrapeReplayAction.ts export set so the
 * top-level shim and downstream callers compile unchanged.
 */

export { isRangeIterable } from './Base64Paging.js';
export { default as replaceField } from './JsonReplace.js';
export type { JsonRecord } from './JsonTypes.js';
export type { IMonthChunk } from './MonthChunking.js';
export { generateMonthChunks } from './MonthChunking.js';
export { buildMonthBody, isMonthlyEndpoint } from './RecordShape.js';
