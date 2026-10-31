/**
 * ACCOUNT-RESOLVE slim emit. Mirrors {@link IAuthDiscovery}: the
 * fields downstream consumers actually use — never the raw network
 * pool ACTION harvested. POST commits this; SCRAPE consumes it.
 *
 * <ul>
 *   <li>{@link ids} — card / account ids in commit order; SCRAPE
 *       iterates these to drive per-account fetches.</li>
 *   <li>{@link records} — per-id account records, used by SCRAPE
 *       only when {@link IDashboardTxnHarvest.dedupKeyFieldsByAccount}
 *       requires display-side metadata (e.g. card-number masks).</li>
 *   <li>{@link containers} — per-id sub-record bundles for banks
 *       that ship a "card" wrapper alongside a list of "cycles"
 *       (Backbase) or "products" (Discount).</li>
 *   <li>{@link endpointCaptureIndex} — diagnostic only. Identifies
 *       which capture POST picked. `0` when no endpoint was
 *       chosen (request-side fallback).</li>
 * </ul>
 */
interface IAccountDiscovery {
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
  readonly containers: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly endpointCaptureIndex: number;
}

export type { IAccountDiscovery };
