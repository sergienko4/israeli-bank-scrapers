/**
 * Re-export shim — POST body templating + monthly chunking. The
 * implementation lives in ./ScrapeReplay/. Kept at this path so the
 * full set of historical callers (production + test) compile unchanged.
 *
 * See `./ScrapeReplay/index.ts` for the canonical barrel and the
 * sub-module breakdown:
 *   - JsonReplace.ts     BFS field replace + Base64 fallback
 *   - Base64Paging.ts    paging-context detect + range-iterability
 *   - RecordShape.ts     account-record + month/year substitution
 *   - MonthChunking.ts   monthly ISO chunk generation
 *   - JsonTypes.ts       shared JsonRecord alias
 */

export type { IMonthChunk, JsonRecord } from './ScrapeReplay/index.js';
export {
  buildMonthBody,
  generateMonthChunks,
  isMonthlyEndpoint,
  isRangeIterable,
  replaceField,
} from './ScrapeReplay/index.js';
