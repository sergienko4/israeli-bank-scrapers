/**
 * SCRAPE.PRE — DIRECT discovery composer (Phase 8.5b C5).
 *
 * <p>Thin composer module — delegates all leaf logic to
 * {@link ./DirectFetch.ts}. The composer fns here orchestrate
 * pre-discovery reads → load-ctx build → validation → freeze →
 * discovery-state commit. Re-exports {@link collectStorageSafe}
 * for the FrozenScrapeAction / Mediator surface.
 */

import {
  buildLoadCtxFromPreDiscovered,
  pivotToSpaIfNeeded,
} from '../../../Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { type IFetchAllAccountsCtx } from '../../../Strategy/Scrape/ScrapeTypes.js';
import { some } from '../../../Types/Option.js';
import { type IPipelineContext } from '../../../Types/PipelineContext.js';
import { type Procedure, succeed } from '../../../Types/Procedure.js';
import {
  buildLoadCtxInputs,
  buildScrapeDiscoveryState,
  checkLoadCtxValid,
  collectStorageSafe,
  freezeNetworkSnapshot,
  type IDirectPreReads,
  type IReadyHandle,
} from './DirectFetch.js';
import { readDashboardTxnHarvest, readPreDiscoveredTxn } from './PreDiscovery.js';

type IDiag = IPipelineContext['diagnostics'];
type IProc = Procedure<IPipelineContext>;

/**
 * Run SPA pivot + pre-discovery reads (network, txnEndpoint, harvest).
 *
 * @param ready - Narrowed handle (mediator + api present).
 * @returns Bundled reads consumed by downstream helpers.
 */
async function runPreDiscoveryReads(ready: IReadyHandle): Promise<IDirectPreReads> {
  const network = ready.mediator.network;
  const txnEndpoint = readPreDiscoveredTxn(ready.input);
  const harvest = readDashboardTxnHarvest(ready.input);
  await pivotToSpaIfNeeded({ mediator: ready.mediator, network, txnEndpoint });
  return { network, txnEndpoint, harvest };
}

/**
 * Inner DIRECT discovery — runs once the guard in
 * {@link executeDirectDiscovery} confirms mediator+api are present.
 *
 * @param ready - Narrowed handle (mediator + api present).
 * @param diag - Updated diagnostics.
 * @returns Updated context with frozen scrapeDiscovery.
 */
async function runDirectDiscoveryInner(ready: IReadyHandle, diag: IDiag): Promise<IProc> {
  const reads = await runPreDiscoveryReads(ready);
  const inputs = buildLoadCtxInputs({ ready, reads });
  const loadCtx: IFetchAllAccountsCtx = buildLoadCtxFromPreDiscovered(inputs);
  const failure = checkLoadCtxValid(loadCtx);
  if (failure !== false) return failure;
  const snapshot = await freezeNetworkSnapshot(reads.network, ready.input);
  const disc = buildScrapeDiscoveryState({ loadCtx, snapshot });
  return succeed({ ...ready.input, diagnostics: diag, scrapeDiscovery: some(disc) });
}

/**
 * DIRECT path: discover endpoints + load accounts + freeze network.
 * Runs SPA pivot, endpoint discovery, account loading, storage harvest.
 * Stores everything in scrapeDiscovery for sealed ACTION.
 *
 * @param input - Pipeline context with mediator + api.
 * @param diag - Updated diagnostics.
 * @returns Updated context with frozen scrapeDiscovery.
 */
async function executeDirectDiscovery(input: IPipelineContext, diag: IDiag): Promise<IProc> {
  if (!input.mediator.has || !input.api.has) {
    return succeed({ ...input, diagnostics: diag });
  }
  const ready: IReadyHandle = { input, mediator: input.mediator.value, api: input.api.value };
  return runDirectDiscoveryInner(ready, diag);
}

export { collectStorageSafe, executeDirectDiscovery };
