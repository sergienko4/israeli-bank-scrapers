/**
 * SCRAPE-side strategy helpers — SPA pivot navigation and the
 * load-context builder that consumes ACCOUNT-RESOLVE's discovery.
 *
 * <p>Phase 7c deleted every account-discovery code path that lived
 * here pre-Phase-7. After the deletion, the ONLY account-related
 * logic is reading `ctx.accountDiscovery` (populated upstream
 * by ACCOUNT-RESOLVE.POST). The remaining helpers handle SPA
 * navigation and txn-endpoint discovery — neither touches account
 * data.
 */

import type { IElementMediator } from '../../Mediator/Elements/ElementMediator.js';
import type { INetworkDiscovery } from '../../Mediator/Network/NetworkDiscovery.js';
import type { Brand } from '../../Types/Brand.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { redactUrlFull } from '../../Types/PiiRedactor.js';
import type { IDashboardTxnHarvest, ITxnEndpoint } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IAccountFetchCtx, IFetchAllAccountsCtx } from './ScrapeTypes.js';

/** Whether the txn endpoint URL hosts on the current page origin. */
type IsTxnOnCurrentOrigin = Brand<boolean, 'IsTxnOnCurrentOrigin'>;

const LOG = createLogger('scrape-phase');

/** Timeout for SPA pivot navigation (ms). */
const SPA_PIVOT_TIMEOUT_MS = 15_000;

/**
 * Logs the resolved transaction endpoint URL so the canonical
 * `autoScrape.txnEndpoint` line in `pipeline.log` pins which
 * capture DASHBOARD.FINAL committed as the txn template. Pure
 * pass-through; never mutates the endpoint.
 * @param ep - Slim endpoint committed by DASHBOARD.FINAL.
 * @returns The same endpoint, unchanged.
 */
function logTxnEndpoint(ep: ITxnEndpoint): ITxnEndpoint {
  if (ep.url !== '') {
    LOG.debug({
      event: 'autoScrape.txnEndpoint',
      picked: redactUrlFull(ep.url),
      method: ep.method,
    });
    return ep;
  }
  LOG.debug({ event: 'autoScrape.txnEndpoint', picked: 'none' });
  return ep;
}

/** Bundled args for {@link buildLoadCtxFromPreDiscovered}. */
interface IPreDiscoveredArgs {
  readonly fc: IAccountFetchCtx;
  readonly txnEndpoint: ITxnEndpoint;
  readonly harvest: IDashboardTxnHarvest;
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
}

/**
 * Builds the SCRAPE per-account fetch context from the account list
 * ACCOUNT-RESOLVE.POST already committed to `ctx.accountDiscovery`,
 * paired with the TXN endpoint DASHBOARD.FINAL committed to
 * `ctx.txnEndpoint` and the DASHBOARD-side harvest committed to
 * `ctx.dashboardTxnHarvest` (Phase 7f). Strict SRP — never re-runs
 * discovery here; the upstream phases own each contract.
 *
 * @param args - Bundled fetch context, account ids/records, the
 *   pre-resolved slim txn endpoint, and the DASHBOARD harvest.
 * @returns Fetch-all context ready for the matrix loop.
 */
function buildLoadCtxFromPreDiscovered(args: IPreDiscoveredArgs): IFetchAllAccountsCtx {
  logTxnEndpoint(args.txnEndpoint);
  const fc: IAccountFetchCtx = { ...args.fc, dashboardTxnHarvest: args.harvest };
  return {
    fc,
    ids: [...args.ids],
    records: [...args.records],
    txnEndpoint: args.txnEndpoint,
    dashboardTxnHarvest: args.harvest,
  };
}

/**
 * Returns true when the txn endpoint URL's origin matches the page
 * the browser currently sits on. Drives the SPA-pivot decision in
 * {@link pivotToSpaIfNeeded}: if the txn endpoint is hosted on the
 * current origin, no pivot is needed.
 * @param txnEndpoint - Pre-resolved slim TXN endpoint.
 * @param currentOrigin - Current page origin.
 * @returns Branded boolean signal.
 */
function isTxnHostedOnCurrentOrigin(
  txnEndpoint: ITxnEndpoint,
  currentOrigin: string,
): IsTxnOnCurrentOrigin {
  if (txnEndpoint.url === '') return false as IsTxnOnCurrentOrigin;
  return (new URL(txnEndpoint.url).origin === currentOrigin) as IsTxnOnCurrentOrigin;
}

/** Bundled args for {@link pivotToSpaIfNeeded}. */
interface IPivotArgs {
  readonly mediator: IElementMediator;
  readonly network: INetworkDiscovery;
  readonly txnEndpoint: ITxnEndpoint;
}

/**
 * Navigates to the SPA origin when the API traffic was captured from
 * a different domain than the page is on, so subsequent fetch calls
 * carry the SPA's cookies and CORS context. Skips the pivot when the
 * txn endpoint is already hosted on the current origin. SCRAPE consumes
 * the pre-resolved `txnEndpoint`; only the SPA-URL probe stays on the
 * network surface (DASHBOARD-side concern, transport substrate).
 *
 * @param args - Mediator, network, pre-resolved txnEndpoint.
 * @returns Procedure with true after pivot, false when no pivot.
 */
async function pivotToSpaIfNeeded(args: IPivotArgs): Promise<Procedure<boolean>> {
  const { mediator, network, txnEndpoint } = args;
  const spaUrl = network.discoverSpaUrl();
  if (!spaUrl) return succeed(false);
  const currentOrigin = new URL(mediator.getCurrentUrl()).origin;
  const spaOrigin = new URL(spaUrl).origin;
  if (currentOrigin === spaOrigin) return succeed(false);
  if (isTxnHostedOnCurrentOrigin(txnEndpoint, currentOrigin)) {
    LOG.debug({
      message:
        'SPA pivot: skip — current origin ' +
        `${maskVisibleText(currentOrigin)} hosts txn endpoint`,
    });
    return succeed(false);
  }
  LOG.debug({
    message: `SPA pivot: ${maskVisibleText(currentOrigin)} → ${maskVisibleText(spaOrigin)}`,
  });
  const opts = { waitUntil: 'domcontentloaded' as const, timeout: SPA_PIVOT_TIMEOUT_MS };
  await mediator.navigateTo(spaUrl, opts);
  return succeed(true);
}

export { buildLoadCtxFromPreDiscovered, pivotToSpaIfNeeded };
