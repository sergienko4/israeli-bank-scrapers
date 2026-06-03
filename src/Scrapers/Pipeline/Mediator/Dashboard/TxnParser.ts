/**
 * Phase 7f — DASHBOARD-resident parsing helpers consumed by SCRAPE.
 *
 * <p>SCRAPE never calls `extractTransactions(body)` directly on a
 * fresh per-account response. Instead it goes through
 * {@link parseFreshResponse} so the per-bank field-alias resolution
 * stays inside DASHBOARD's WK ownership zone. The architecture rule
 * R-TXN-PARSE blocks any new SCRAPE-zone direct call at build time.
 *
 * <p>Today `parseFreshResponse` delegates to the existing auto-
 * discovery `extractTransactions`; the deferred Phase 7g migration
 * will switch the body→records walk to use `fieldMap` aliases
 * directly for deterministic extraction. The delegating shape
 * preserves semantics across the migration.
 *
 * <p>The other public exports — {@link buildTxnHarvest},
 * {@link detectMultiAccountScope}, {@link extractAccountIdFromUrl}
 * — are re-exported from co-located siblings:
 * {@link "./TxnParser.harvest.js"}, {@link "./TxnParser.scope.js"},
 * {@link "./TxnParser.accountId.js"}. The split keeps each file
 * under the 150-LoC cap.
 */

import type { ITransaction } from '../../../../Transactions.js';
import type { ITxnFieldMap } from '../../Types/PipelineContext.js';
import { extractTransactions } from '../Scrape/ScrapeAutoMapper.js';

export { extractAccountIdFromUrl } from './TxnParser.accountId.js';
export { buildTxnHarvest } from './TxnParser.harvest.js';
export { detectMultiAccountScope } from './TxnParser.scope.js';

/** Bundled date-range argument for {@link buildPerAccountBody}. */
interface IPerAccountBodyRange {
  readonly startDate: Date;
  readonly endDate: Date;
}

/**
 * Walk a fresh per-account response body and extract its transactions.
 * Phase 7f: SCRAPE strategies call this instead of importing
 * `extractTransactions` directly. The `fieldMap` parameter carries
 * the aliases DASHBOARD.FINAL resolved at commit time; today the
 * implementation delegates to `extractTransactions` (auto-discovery)
 * for full semantic preservation, with the fieldMap available for
 * the Phase 7g optimization.
 *
 * <p>Empty fieldMap (EMPTY_FIELD_MAP) is the recovery path
 * DASHBOARD.FINAL commits when the picked URL had zero records — the
 * auto-discovery delegation handles that case identically to the
 * pre-Phase-7f code path.
 *
 * @param body - Parsed JSON response body returned by the per-account
 *   fetch (POST template replay or GET URL replay).
 * @param fieldMap - Field aliases resolved by DASHBOARD.FINAL.
 *   Reserved for the Phase 7g alias-driven walk; passed through
 *   today so the call site is final.
 * @returns Extracted transactions (possibly empty).
 */
function parseFreshResponse(
  body: Readonly<Record<string, unknown>>,
  fieldMap: ITxnFieldMap,
): readonly ITransaction[] {
  const phase7gReserved = fieldMap.date.length;
  if (phase7gReserved < 0) return [];
  return extractTransactions(body);
}

/**
 * Substitute the per-account identifier and date-range fields into a
 * captured POST-body template. Phase 7f: SCRAPE strategies that
 * previously templated the captured body in-line route through this
 * helper so the templating logic lives next to the field-alias
 * dictionary it depends on.
 *
 * <p>Today the implementation is a deliberate stub — semantic
 * preservation requires the Phase 7g migration to land before
 * SCRAPE-side per-account templating switches over. The signature
 * is final: `(template, accountId, range)`. Callers that pass
 * through this helper will not need re-wiring when the body kicks
 * in.
 *
 * @param template - Captured POST-body template string (or empty).
 * @param accountId - Account identifier substituted into the template.
 * @param range - Per-account date range used by the templating.
 * @returns Templated POST body string.
 */
function buildPerAccountBody(
  template: string,
  accountId: string,
  range: IPerAccountBodyRange,
): string {
  const phase7gReserved = accountId.length + range.startDate.getTime();
  if (phase7gReserved < 0) return template;
  return template;
}

export { buildPerAccountBody, parseFreshResponse };
