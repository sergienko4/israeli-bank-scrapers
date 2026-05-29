import type { ITransaction } from '../../../../Transactions.js';

/**
 * Field-name aliases resolved once per run by DASHBOARD.FINAL via
 * {@link resolveTxnEndpoint}. SCRAPE walks fresh per-account
 * responses by these aliases instead of importing `WK_TXN`. Phase 7e
 * shifts every TXN-side WK access into DASHBOARD's TxnParser; the
 * resolved aliases ride along as part of `ctx.txnEndpoint`.
 *
 * <p>`originalAmount`, `processedDate`, `balance` are nullable
 * (typed `string | false`) because not every bank exposes them
 * (card-family banks omit `balance`; Discount-class banks omit
 * `originalAmount`). Consumers test the boolean before walking.
 */
interface ITxnFieldMap {
  readonly date: string;
  readonly amount: string;
  readonly description: string;
  readonly currency: string;
  readonly identifier: string;
  readonly originalAmount: string | false;
  readonly processedDate: string | false;
  readonly balance: string | false;
}

/**
 * TXN endpoint contract committed by DASHBOARD.FINAL onto
 * `ctx.txnEndpoint`. Phase 7f: this is the slim, SCRAPE-facing
 * payload — only the fields SCRAPE actually consumes. Mirrors how
 * `IAccountDiscovery` carries only the SCRAPE-facing payload (ids,
 * records, containers).
 *
 * <ul>
 *   <li>`url`/`method` — the resolved endpoint (template URL).</li>
 *   <li>`templatePostData` — raw POST body for SCRAPE.PRE to clone
 *     and substitute per-account ids; `false` for GET banks.</li>
 *   <li>`fieldMap` — resolved field-name aliases (date / amount / …)
 *     so SCRAPE walks fresh responses without WK access.</li>
 *   <li>`pendingUrl` — pre-resolved pending-transactions API URL (or
 *     `false` when the bank doesn't expose pending).</li>
 *   <li>`billingUrl` — pre-resolved billing-fallback URL (or `false`
 *     when the bank's family doesn't carry the billing path).</li>
 * </ul>
 *
 * <p>DASHBOARD-internal artefacts (`captureIndex`,
 * `responseBodySample`, `normalizedRecords`, `pickerTier`,
 * `capturedPreClick`) live on {@link ITxnEndpointInternal} which
 * never travels on `ctx`; they emit via the
 * `dashboard.txnEndpoint.committed` telemetry event only.
 */
interface ITxnEndpoint {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly templatePostData: string | false;
  readonly fieldMap: ITxnFieldMap;
  readonly pendingUrl: string | false;
  readonly billingUrl: string | false;
}

/**
 * DASHBOARD-internal type returned by `resolveTxnEndpoint` and
 * consumed only inside `Mediator/Dashboard/`. Carries the slim
 * SCRAPE-facing `endpoint` plus the diagnostic / telemetry artefacts
 * that DASHBOARD needs to log but SCRAPE must not see.
 *
 * <p>`captureIndex` is the index of the picked capture inside the
 * network pool. `responseBodySample` is the raw captured body that
 * resolved the field-map. `normalizedRecords` is the pre-parsed
 * sample (used for buffered-account shortcuts inside DASHBOARD only).
 * `pickerTier` records which tier the picker picked from
 * (postWithShape / replayablePost / shapePassing / preClickFallback /
 * none). `capturedPreClick` is true when the resolver fell back to
 * the pre-click pool because the post-click pool was empty.
 */
interface ITxnEndpointInternal {
  readonly endpoint: ITxnEndpoint;
  readonly captureIndex: number;
  readonly responseBodySample: Readonly<Record<string, unknown>>;
  readonly normalizedRecords: readonly ITransaction[];
  readonly pickerTier: PickerTier;
  readonly capturedPreClick: boolean;
}

/**
 * Picker tier preference name. The picker walks the captured pool in
 * tier order and emits one of these labels per `discover.shapeAware`
 * event so the chosen URL's provenance is traceable from logs.
 */
type PickerTier =
  | 'postWithShape'
  | 'replayablePost'
  | 'shapePassing'
  | 'preClickFallback'
  | 'urlOnlyMatch'
  | 'windowParamsMatch'
  | 'none';

export type { ITxnEndpoint, ITxnEndpointInternal, ITxnFieldMap, PickerTier };
