/**
 * Scrape data helpers — barrel facade.
 *
 * <p>Phase 12e (2026-06-15): the former 467-line `ScrapeDataActions.ts`
 * helper module was drained into focused co-located modules under
 * `Strategy/Scrape/ScrapeData/` behind this unchanged barrel facade:
 *
 * - {@link ./ScrapeData/ScrapeDataDedup.ts | ScrapeDataDedup} — rate
 *   limiting, date parsing, transaction hashing + dedup
 *   (`parseStartDate`, `rateLimitPause`, `txnHash`, `deduplicateTxns`,
 *   `FALLBACK_DEDUP_KEY_FIELDS`).
 * - {@link ./ScrapeData/ScrapeDataTemplating.ts | ScrapeDataTemplating}
 *   — POST-body templating (`templatePostBody`).
 * - {@link ./ScrapeData/ScrapeDataUrl.ts | ScrapeDataUrl} — txn URL
 *   build + resolution (`buildFilterDataUrl`, `resolveTxnUrl`).
 * - {@link ./ScrapeData/ScrapeDataAssembly.ts | ScrapeDataAssembly} —
 *   account-result assembly (`buildAccountResult`).
 *
 * The public surface is unchanged — consumers import every helper from
 * this module verbatim. Monthly chunking (`applyGlobalDateFilter`,
 * `scrapeWithMonthlyChunking`) is re-exported from `ScrapeChunking.ts`.
 *
 * v4 (2026-05-27): balance lookup moved out of SCRAPE. Balance
 * resolution is owned exclusively by the BALANCE-RESOLVE phase, which
 * consumes `scrape.perAccountResponses` and writes
 * `ctx.balanceResolution`. SCRAPE here owns only `accountNumber` and
 * `txns` on the assembled account.
 */

export { applyGlobalDateFilter, scrapeWithMonthlyChunking } from './ScrapeChunking.js';
export { default as buildAccountResult } from './ScrapeData/ScrapeDataAssembly.js';
export {
  deduplicateTxns,
  FALLBACK_DEDUP_KEY_FIELDS,
  parseStartDate,
  rateLimitPause,
  txnHash,
} from './ScrapeData/ScrapeDataDedup.js';
export { default as templatePostBody } from './ScrapeData/ScrapeDataTemplating.js';
export { buildFilterDataUrl, resolveTxnUrl } from './ScrapeData/ScrapeDataUrl.js';
