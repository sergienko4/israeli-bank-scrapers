import type { ITransaction } from '../../../../Transactions.js';

/**
 * DASHBOARD harvest committed by DASHBOARD.FINAL on a separate
 * `ctx.dashboardTxnHarvest` field — clean value-type pass of the
 * pre-extracted records. Mirrors `IAccountDiscovery.records`: the
 * phase that captured the response also normalizes the records and
 * commits them; downstream phases consume `readonly ITransaction[]`
 * without touching the captured body or `IDiscoveredEndpoint`.
 *
 * <p>Scope semantics:
 * <ul>
 *   <li>{@link capturedAccountId} = string — the captured request was
 *     scoped to one accountId (e.g. Hapoalim's
 *     `accountId=12-170-536347` URL param). SCRAPE applies the
 *     records only when the iteration's accountId is compatible
 *     (suffix match — handles raw-vs-display id formats).</li>
 *   <li>{@link capturedAccountId} = `false` — the captured request
 *     was unscoped (no per-account id in URL/body); applies to the
 *     single-account bank as a whole.</li>
 *   <li>{@link multiAccountScope} = true — the captured body bundled
 *     records for many accounts (`cards: [...]`, `accounts: [...]`).
 *     SCRAPE refuses reuse and falls through to per-account fetches
 *     so each card's records are correctly attributed.</li>
 * </ul>
 */
interface IDashboardTxnHarvest {
  readonly records: readonly ITransaction[];
  readonly capturedAccountId: string | false;
  readonly multiAccountScope: boolean;
  /**
   * Per-account dedup-key field tuple. Maps an accountId (or `''`
   * sentinel for unscoped captures) to the list of
   * {@link ITransaction} field names SCRAPE must use to dedup that
   * account's rows.
   *
   * <p>Typical contents are `['identifier']` when every row in
   * the account's harvest carries a distinct per-txn identifier, or
   * `['date', 'identifier', 'originalAmount']` when the
   * identifier collides across rows (Beinleumi's `reference` field
   * is a transaction-TYPE code shared across recurring monthly txns).
   *
   * <p>DASHBOARD picks the tuple by shape inspection on the
   * normalized-records sample (see
   * {@link ./../Mediator/Dashboard/DedupKeyFieldsDetector}); the
   * detector skips empty harvests and multi-scope captures, so the
   * map is empty in those cases. SCRAPE consumers fall back to
   * `['identifier']` when the map is empty (legacy/test ergonomics).
   */
  readonly dedupKeyFieldsByAccount?: ReadonlyMap<string, readonly string[]>;
  /**
   * Phase H'' (2026-05-15): per-account WK-aliased date-window URL
   * parameter tuple. Maps an accountId (or `''` sentinel) to a
   * two-element `[fromAlias, toAlias]` array of WK.fromDate /
   * WK.toDate names the bank actually uses on its txn URL / response
   * body. SCRAPE consumes this to drive `applyDateRangeToUrl` window
   * injection — when SCRAPE has a captured txn URL that's missing the
   * date-range params, it APPENDS them using the aliases from this
   * tuple. Empty / absent → no append (no-op for banks whose
   * captured URLs already carry WK-aliased date params explicitly).
   *
   * <p>DASHBOARD picks the tuple via shape inspection on the
   * captured pool (see
   * {@link ./../Mediator/Dashboard/DateWindowParamsDetector}). Zero
   * bank-name knowledge — WK aliases drive the matching.
   */
  readonly dateWindowParamsByAccount?: ReadonlyMap<string, readonly [string, string]>;
}

/**
 * Empty-harvest sentinel for SCRAPE consumers when DASHBOARD did
 * not commit a harvest (no captured TXN body or harvest scope was
 * multi-account and the iteration's account doesn't match). Lives
 * next to {@link IDashboardTxnHarvest} so SCRAPE consumes it from
 * Types — kills the prior cross-zone SCRAPE → Dashboard import.
 */
const EMPTY_TXN_HARVEST: IDashboardTxnHarvest = {
  records: [],
  capturedAccountId: false,
  multiAccountScope: false,
};

export { EMPTY_TXN_HARVEST };
export type { IDashboardTxnHarvest };
