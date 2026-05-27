/**
 * SCRAPE phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    forensic priming + endpoint discovery + freeze (DIRECT)
 * ACTION: frozen matrix loop (no browser, no network — sealed)
 * POST:   audit diagnostics (forensic audit table)
 * FINAL:  stamp account count for audit trail
 */

import moment from 'moment';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../Registry/WK/ScrapeWK.js';
import {
  buildLoadCtxFromPreDiscovered,
  pivotToSpaIfNeeded,
} from '../../Strategy/Scrape/GenericAutoScrapeStrategy.js';
import { FALLBACK_DEDUP_KEY_FIELDS } from '../../Strategy/Scrape/ScrapeDataActions.js';
import { EMPTY_TXN_ENDPOINT, type IAccountFetchCtx } from '../../Strategy/Scrape/ScrapeTypes.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import {
  EMPTY_TXN_HARVEST,
  type IAccountIdentity,
  type IActionContext,
  type IBalanceFetchTemplate,
  type IBillingCycleCatalog,
  type IDashboardTxnHarvest,
  type IPipelineContext,
  type ITxnEndpoint,
} from '../../Types/PipelineContext.js';
import { fail, type Procedure, succeed } from '../../Types/Procedure.js';
import { getFutureMonths } from '../../Types/ScraperDefaults.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import { logForensicAudit } from './ForensicAuditAction.js';
import { executeFrozenDirectScrape } from './FrozenScrapeAction.js';
import { findFieldValue } from './ScrapeAutoMapper.js';
import { triggerDashboardUi } from './ScrapeUiTrigger.js';

const LOG = createLogger('scrape-phase');

/**
 * Build the base diagnostics for scrape PRE.
 * @param input - Pipeline context.
 * @returns Updated diagnostics with fetchStartMs.
 */
function buildPreDiag(input: IPipelineContext): IPipelineContext['diagnostics'] {
  const nowMs = Date.now();
  return { ...input.diagnostics, fetchStartMs: some(nowMs), lastAction: 'scrape-pre' };
}

/**
 * Run forensic priming if dashboard was not primed.
 * Delegates to Mediator's triggerDashboardUi — zero WK in Phase.
 * @param input - Pipeline context.
 * @returns Procedure after priming attempt.
 */
async function maybeForensicPrime(input: IPipelineContext): Promise<Procedure<boolean>> {
  const isPrimed = !input.dashboard.has || input.dashboard.value.trafficPrimed;
  if (isPrimed || !input.mediator.has) return succeed(true);
  input.logger.debug({
    message: 'trafficPrimed=false -> Forensic via Mediator',
  });
  return triggerDashboardUi(input.mediator.value, input.logger);
}

/** Pre-discovered account list bundle (or empty when missing). */
interface IPreDiscoveredAccounts {
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
}

/**
 * Reads the account list ACCOUNT-RESOLVE.POST committed to
 * `ctx.accountDiscovery`. Returns empty arrays when the option
 * is absent — the pipeline invariant from Phase 7+7b prevents that
 * case from reaching SCRAPE on a successful run, so an empty result
 * here is a programming error rather than a recoverable state.
 * @param input - Pipeline context.
 * @returns Pre-discovered account ids + records (empties on miss).
 */
function readPreDiscoveredAccounts(input: IPipelineContext): IPreDiscoveredAccounts {
  if (!input.accountDiscovery.has) return { ids: [], records: [] };
  return {
    ids: input.accountDiscovery.value.ids,
    records: input.accountDiscovery.value.records,
  };
}

/**
 * Reads the TXN endpoint DASHBOARD.FINAL committed to
 * `ctx.txnEndpoint`. Mirror of {@link readPreDiscoveredAccounts} —
 * pure read, no adapter, no network surface. Returns
 * {@link EMPTY_TXN_ENDPOINT} when the option is absent so callers
 * never branch on `Option.has` themselves.
 *
 * <p>Phase 7f replaces the deleted `TxnEndpointBridge.readTxnEndpoint`.
 * The bridge re-shaped the typed `ITxnEndpoint` into the legacy
 * `IDiscoveredEndpoint` runtime shape so SCRAPE could keep its old
 * types — that was a back door. The new reader returns the typed
 * contract directly; SCRAPE strategies consume `ITxnEndpoint` fields
 * by name and never see `IDiscoveredEndpoint`.
 *
 * @param input - Pipeline context.
 * @returns Slim TXN endpoint (or EMPTY_TXN_ENDPOINT on miss).
 */
function readPreDiscoveredTxn(input: IPipelineContext | IActionContext): ITxnEndpoint {
  // Defensive: legacy test mocks build IActionContext without
  // `txnEndpoint`; the production type guarantees the field, but
  // mocks predate Phase 7e. Optional-chain reads the option's `has`
  // flag through both possible miss paths in one expression.
  const opt = (input as { readonly txnEndpoint?: IPipelineContext['txnEndpoint'] }).txnEndpoint;
  if (!opt?.has) return EMPTY_TXN_ENDPOINT;
  return opt.value;
}

/**
 * Reads the DASHBOARD-side harvest committed by DASHBOARD.FINAL on
 * `ctx.dashboardTxnHarvest`. Mirror of {@link readPreDiscoveredTxn}
 * and {@link readPreDiscoveredAccounts} — pure read, no adapter.
 * Returns {@link EMPTY_TXN_HARVEST} when the option is absent so
 * callers (SCRAPE strategies, tests, mock contexts) never branch on
 * `Option.has`.
 *
 * <p>SCRAPE consumes the harvest's `records` (a clean
 * `readonly ITransaction[]`) when the iteration's accountId matches
 * the captured scope — recovering the per-account fast path that
 * tryBufferedResponse provided pre-Phase-7f, but as a typed value
 * pass instead of a network-surface back door.
 *
 * @param input - Pipeline context.
 * @returns Harvest payload (empty when DASHBOARD did not commit).
 */
function readDashboardTxnHarvest(input: IPipelineContext | IActionContext): IDashboardTxnHarvest {
  const opt = (input as { readonly dashboardTxnHarvest?: IPipelineContext['dashboardTxnHarvest'] })
    .dashboardTxnHarvest;
  if (!opt?.has) return EMPTY_TXN_HARVEST;
  return opt.value;
}

/**
 * Reads the per-card dedup-key field tuple from the harvest's
 * `dedupKeyFieldsByAccount` map. Phase G: DASHBOARD picks one tuple
 * per capture; in practice the map has one entry, so the first value
 * applies to every per-account dedup downstream.
 *
 * <p>Returns the supplied fallback tuple when DASHBOARD did not emit
 * a map entry (empty harvest, multi-account-scope skip, or pre-Phase-G
 * test mock). Never returns `null` / `undefined` per architecture rule.
 *
 * @param harvest - DASHBOARD harvest (may be `EMPTY_TXN_HARVEST`).
 * @param fallback - Tuple returned when no map entry is present.
 * @returns Resolved dedup-key field tuple.
 */
function readDedupKeyFields(
  harvest: IDashboardTxnHarvest,
  fallback: readonly string[],
): readonly string[] {
  const map = harvest.dedupKeyFieldsByAccount;
  if (map === undefined || map.size === 0) return fallback;
  const iterResult = map.values().next();
  if (iterResult.done) return fallback;
  return iterResult.value;
}

/** Empty WK-alias tuple — used when the harvest carries no detected pair. */
const EMPTY_DATE_WINDOW_PARAMS: readonly string[] = Object.freeze([]);

/**
 * Reads the per-card WK-aliased `[fromAlias, toAlias]` tuple from the
 * harvest's `dateWindowParamsByAccount` map. Phase H'' (2026-05-15):
 * DASHBOARD picks one tuple per capture via shape inspection; in
 * practice the map has one entry, so the first value applies to every
 * per-account scrape downstream.
 *
 * <p>Returns {@link EMPTY_DATE_WINDOW_PARAMS} when DASHBOARD did not
 * emit a map entry (empty harvest, multi-account-scope skip, or no
 * WK alias pair observed in the pool). Never returns `null` /
 * `undefined` per architecture rule.
 *
 * @param harvest - DASHBOARD harvest (may be `EMPTY_TXN_HARVEST`).
 * @returns Resolved `[fromAlias, toAlias]` tuple or empty array.
 */
function readDateWindowParams(harvest: IDashboardTxnHarvest): readonly string[] {
  const map = harvest.dateWindowParamsByAccount;
  if (map === undefined || map.size === 0) return EMPTY_DATE_WINDOW_PARAMS;
  const iterResult = map.values().next();
  if (iterResult.done) return EMPTY_DATE_WINDOW_PARAMS;
  return iterResult.value;
}

/** Empty catalog sentinel — used as the "no catalog" return value. */
const EMPTY_CATALOG: IBillingCycleCatalog = { cycles: [] };

/**
 * Reads the billing-cycle catalog committed by ACCOUNT-RESOLVE.POST
 * on `ctx.accountDiscovery.value.billingCycleCatalog`. Mirror of
 * {@link readDashboardTxnHarvest} — pure read, no adapter. Returns
 * the {@link EMPTY_CATALOG} sentinel when the option is absent or
 * when ACCOUNT-RESOLVE found no recognised cycle shape; SCRAPE
 * consumers branch on `cycles.length` and fall back to month-chunk
 * iteration when the catalog is empty.
 *
 * @param input - Pipeline context.
 * @returns Catalog when present; empty sentinel otherwise.
 */
function readBillingCycleCatalog(input: IPipelineContext | IActionContext): IBillingCycleCatalog {
  const opt = (input as { readonly accountDiscovery?: IPipelineContext['accountDiscovery'] })
    .accountDiscovery;
  if (!opt?.has) return EMPTY_CATALOG;
  return opt.value.billingCycleCatalog ?? EMPTY_CATALOG;
}

export { EMPTY_TXN_ENDPOINT } from '../../Strategy/Scrape/ScrapeTypes.js';
export { EMPTY_TXN_HARVEST } from '../../Types/PipelineContext.js';
export {
  readBillingCycleCatalog,
  readDashboardTxnHarvest,
  readDateWindowParams,
  readDedupKeyFields,
  readPreDiscoveredTxn,
};

/**
 * DIRECT path: discover endpoints + load accounts + freeze network.
 * Runs SPA pivot, endpoint discovery, account loading, storage harvest.
 * Stores everything in scrapeDiscovery for sealed ACTION.
 * @param input - Pipeline context with mediator + api.
 * @param diag - Updated diagnostics.
 * @returns Updated context with frozen scrapeDiscovery.
 */
async function executeDirectDiscovery(
  input: IPipelineContext,
  diag: IPipelineContext['diagnostics'],
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has || !input.api.has) {
    return succeed({ ...input, diagnostics: diag });
  }
  const api = input.api.value;
  const network = input.mediator.value.network;
  const mediator = input.mediator.value;

  // Phase 7f: SCRAPE consumes the slim ITxnEndpoint DASHBOARD.FINAL
  // committed to ctx.txnEndpoint. Pure read, no adapter, no fallback
  // to network re-discovery — the architecture invariant guarantees
  // the commit landed before SCRAPE starts (DASHBOARD halts otherwise
  // via F-DASH-1/2/3). pendingUrl / billingUrl live nested inside the
  // slim endpoint; sibling fields removed from IAccountFetchCtx.
  const txnEndpoint = readPreDiscoveredTxn(input);
  // Phase 7f follow-up: DASHBOARD-side harvest carries the pre-extracted
  // records DASHBOARD already saw. SCRAPE consumes them via tryFirstWave
  // when the iteration's accountId matches the captured scope, avoiding
  // the redundant per-account fetch that bank anti-bot guards reject
  // with 302 (Hapoalim-class regression).
  const harvest = readDashboardTxnHarvest(input);
  await pivotToSpaIfNeeded({ mediator, network, txnEndpoint });

  // Account discovery moved to ACCOUNT-RESOLVE.POST (Phase 7d); SCRAPE.PRE
  // consumes the pre-discovered list. TXN-endpoint discovery moved to
  // DASHBOARD.FINAL (Phase 7e); SCRAPE.PRE consumes ctx.txnEndpoint.
  const startDate = moment(input.options.startDate).format('YYYYMMDD');
  const futureMonths = getFutureMonths(input.options);
  const billingCycleCatalog = readBillingCycleCatalog(input);
  const dedupKeyFields = readDedupKeyFields(harvest, FALLBACK_DEDUP_KEY_FIELDS);
  const dateWindowParams = readDateWindowParams(harvest);
  const fc: IAccountFetchCtx = {
    api,
    network,
    startDate,
    futureMonths,
    txnEndpoint,
    dashboardTxnHarvest: harvest,
    billingCycleCatalog,
    dedupKeyFields,
    dateWindowParams,
  };
  const preDiscovered = readPreDiscoveredAccounts(input);
  const loadCtx = buildLoadCtxFromPreDiscovered({
    fc,
    txnEndpoint,
    harvest,
    ids: preDiscovered.ids,
    records: preDiscovered.records,
  });

  // Defense-in-depth: ACCOUNT-RESOLVE.POST should never let an empty
  // id list through (Phase 7+7b's contract), but if it somehow does,
  // SCRAPE refuses to silently scrape a sentinel id like 'default'.
  if (loadCtx.ids.length === 0 && (loadCtx.txnEndpoint?.url ?? '') !== '') {
    return fail(
      ScraperErrorTypes.Generic,
      'scrape: no usable account identifier in ctx.accountDiscovery',
    );
  }

  const frozenEndpoints = network.getAllEndpoints();
  const cachedAuth = await network.discoverAuthToken();
  const storageHarvest = await collectStorageSafe(input);
  // Carry the dashboard-click timestamp into the frozen replay so
  // SCRAPE.ACTION's frozen network sees the same pre-nav / post-nav
  // split that the live network used during DASHBOARD.FINAL
  // validation. Without this the frozen network has no click marker
  // and falls back to the full pool, which would re-introduce the
  // pre-click widget pollution we just removed.
  const dashboardClickAt = network.getDashboardClickAt();

  const idCount = String(loadCtx.ids.length);
  const recCount = String(loadCtx.records.length);
  const epCount = String(frozenEndpoints.length);
  LOG.debug({
    message: `[PRE] DIRECT: ${idCount} accts, ${recCount} recs, ${epCount} eps frozen`,
  });

  const disc = {
    qualifiedCards: [...loadCtx.ids],
    prunedCards: [] as string[],
    txnTemplateUrl: '',
    txnTemplateBody: {} as Record<string, unknown>,
    billingMonths: [] as string[],
    frozenEndpoints: [...frozenEndpoints],
    accountIds: [...loadCtx.ids],
    rawAccountRecords: [...loadCtx.records],
    txnEndpoint: loadCtx.txnEndpoint,
    cachedAuth,
    storageHarvest,
    dashboardClickAt,
  };

  return succeed({
    ...input,
    diagnostics: diag,
    scrapeDiscovery: some(disc),
  });
}

/**
 * Collect sessionStorage safely.
 * @param ctx - Pipeline context.
 * @returns Storage key-value pairs or empty.
 */
async function collectStorageSafe(ctx: IPipelineContext): Promise<Record<string, string>> {
  if (!ctx.browser.has) return {};
  const page = ctx.browser.value.page;
  return page
    .evaluate((): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const key of Object.keys(sessionStorage)) out[key] = sessionStorage.getItem(key) ?? '';
      return out;
    })
    .catch((): Record<string, string> => ({}));
}

/**
 * PRE: Forensic priming + DIRECT discovery. After .ashx removal there is
 * exactly one strategy — DIRECT.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics + scrapeDiscovery.
 */
async function executeForensicPre(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  await maybeForensicPrime(input);
  const diag = buildPreDiag(input);
  return executeDirectDiscovery(input, diag);
}

/**
 * ACTION (sealed): Frozen matrix loop — uses scrapeDiscovery + api only.
 * @param input - Sealed action context.
 * @returns Updated context with scraped accounts.
 */
async function executeMatrixLoop(input: IActionContext): Promise<Procedure<IActionContext>> {
  return executeFrozenDirectScrape(input);
}

/**
 * POST: Audit diagnostics — forensic audit table for qualified/pruned cards.
 *
 * <p>v4 Issue 2 fix: distinguishes a true scrape miss (no capture
 * pool, no 2xx responses) from a legitimate empty result (some
 * 2xx responses landed but every account returned 0 txns — happens
 * for fresh-issue cards or accounts with no activity in the window).
 * The npm package now accepts the legitimate-empty case via the
 * capture-pool heuristic; CI/E2E suites with real banks always
 * produce a populated pool + 2xx responses so they continue to
 * fail-fast on true misses.
 *
 * @param input - Pipeline context after scraping.
 * @returns Updated context with post diagnostics.
 */
function executeValidateResults(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const accountCount = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const countStr = String(accountCount);
  if (input.scrape.has) logForensicAudit(input);
  warnZeroAmounts(input);
  const emptyDecision = decideEmptyGate(input, countStr, accountCount);
  if (emptyDecision !== false) return Promise.resolve(emptyDecision);
  const diag = { ...input.diagnostics, lastAction: `scrape-post (${countStr} accounts)` };
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

/**
 * Decide whether SCRAPE.POST should hard-fail because every account
 * landed with 0 txns. Returns:
 *   - false  : not the empty-everywhere state; caller continues.
 *   - fail   : every account empty AND heuristic flags a scrape miss.
 * Real-empty accepted path emits a structured info log and returns
 * `false` so the caller continues into the normal success path.
 * @param input - Pipeline context.
 * @param countStr - String form of account count for the message.
 * @param accountCount - Account count integer for telemetry.
 * @returns Decision: false to continue, or a terminal Procedure.
 */
function decideEmptyGate(
  input: IPipelineContext,
  countStr: string,
  accountCount: number,
): Procedure<IPipelineContext> | false {
  if (!isAllAccountsEmpty(input)) return false;
  const verdict = checkScrapeMissHeuristic(input);
  if (verdict.isMiss) {
    const errMsg =
      `scrape.post: all ${countStr} accounts have 0 txns AND ` +
      'scrape miss heuristic flagged — fail';
    return fail(ScraperErrorTypes.Generic, errMsg);
  }
  emitRealEmptyAccepted(input, { accountCount, ...verdict });
  return false;
}

/** Heuristic verdict returned by {@link checkScrapeMissHeuristic}. */
interface IScrapeMissVerdict {
  readonly isMiss: boolean;
  readonly poolSize: number;
  readonly successCount: number;
}

/**
 * v4 Issue 2 — capture-pool heuristic. Inspects scrapeDiscovery +
 * mediator state to decide whether the empty-result state is more
 * likely a scrape miss than a legitimate "no activity in window".
 * Returns `isMiss: true` when ANY of:
 *   - scrapeDiscovery option is absent (PRE did not run)
 *   - frozenEndpoints.length === 0 (no endpoints captured)
 *   - mediator absent (no surface to verify response counts)
 *   - countSuccessfulResponses() === 0 (no 2xx responses observed)
 * Returns `isMiss: false` + counters when both surfaces are present.
 * @param input - Pipeline context after scraping.
 * @returns Verdict + counters.
 */
function checkScrapeMissHeuristic(input: IPipelineContext): IScrapeMissVerdict {
  if (!input.scrapeDiscovery.has || !input.mediator.has) {
    return { isMiss: true, poolSize: 0, successCount: 0 };
  }
  const poolSize = input.scrapeDiscovery.value.frozenEndpoints?.length ?? 0;
  if (poolSize === 0) return { isMiss: true, poolSize: 0, successCount: 0 };
  const successCount = input.mediator.value.network.countSuccessfulResponses();
  return { isMiss: successCount === 0, poolSize, successCount };
}

/** Telemetry counters bundle accepted by {@link emitRealEmptyAccepted}. */
interface IRealEmptyCounters {
  readonly accountCount: number;
  readonly poolSize: number;
  readonly successCount: number;
  readonly isMiss?: boolean;
}

/**
 * Emit the structured info log when SCRAPE.POST accepts an empty
 * result as legitimate (prod consumers with no activity in window).
 * Counters only — zero PII surface.
 * @param input - Pipeline context.
 * @param counters - Account / pool / success counters bundle.
 * @returns True after the log is emitted.
 */
function emitRealEmptyAccepted(input: IPipelineContext, counters: IRealEmptyCounters): true {
  input.logger.info({
    event: 'scrape.empty-result-accepted',
    accountCount: String(counters.accountCount),
    poolSize: String(counters.poolSize),
    successCount: String(counters.successCount),
    message: 'all accounts returned 0 txns; pool + responses OK — real empty state',
  });
  return true;
}

/** Transaction amount fields for zero-check. */
interface IAmountFields {
  readonly chargedAmount: number;
  readonly originalAmount: number;
}

/** Zero-amount audit result. */
interface IZeroAudit {
  readonly total: number;
  readonly zeros: number;
}

/**
 * Check if a transaction has zero charged AND original.
 * @param txn - Transaction amount fields.
 * @returns True if both amounts are zero.
 */
function isZeroAmountTxn(txn: IAmountFields): boolean {
  return txn.chargedAmount === 0 && txn.originalAmount === 0;
}

/**
 * Count zero-amount transactions across all accounts.
 * @param accounts - Scraped accounts.
 * @returns Total txn count and zero-amount count.
 */
function countZeroAmounts(accounts: readonly { txns: readonly IAmountFields[] }[]): IZeroAudit {
  const allTxns = accounts.flatMap((a): readonly IAmountFields[] => a.txns);
  const zeros = allTxns.filter(isZeroAmountTxn).length;
  return { total: allTxns.length, zeros };
}

/**
 * Warn if all transaction amounts are 0.00 — diagnostic, not failure.
 * Returns true only when a warning was actually emitted (all txns zero);
 * the no-op branches (no scrape, empty accounts, mixed amounts) return
 * false so the function carries semantic information instead of always
 * yielding the same sentinel.
 * @param input - Pipeline context after scraping.
 * @returns True when the all-zero warning fired.
 */
function warnZeroAmounts(input: IPipelineContext): boolean {
  if (!input.scrape.has) return false;
  const accounts = input.scrape.value.accounts;
  if (accounts.length === 0) return false;
  const { total, zeros } = countZeroAmounts(accounts);
  if (total === 0) return false;
  if (zeros !== total) return false;
  input.logger.warn({
    message: `ALL ${String(total)} transactions have 0.00 amounts`,
  });
  return true;
}

/**
 * Hard sanity gate for SCRAPE.POST. Individual 0-txn accounts are
 * legitimate (dormant cards, just-issued cards, accounts with no
 * activity in the 180-day window). But when EVERY account in the
 * scrape result has 0 txns, that's not a real bank state — it's a
 * silent scrape miss. Live evidence:
 *   - 22 of 25 local host runs on 2026-05-12 (`/c/tmp/runs/pipeline/
 *     isracard/12-05-2026_*`) reported `[PRE] DIRECT: 0 accts, 0 recs,
 *     0 eps frozen` AND `phase-stage result:"OK"`. The test passed
 *     because the assertion checks `errorType === ''`, not the
 *     transaction count.
 *   - The 3 known-good runs that did scrape real data ALL had at
 *     least one account with txns (8 accounts, distribution
 *     0/22/25/25/6/6/0/0 → 5 of 8 accounts non-empty).
 *
 * Returns true ONLY when there's at least one account but every
 * account has zero txns. The 0-accounts case is a different failure
 * mode handled elsewhere; this guard intentionally does not expand
 * its scope per `debugging-guidlines.md` §3 minimal-fix-strategy.
 *
 * @param input - Pipeline context after scraping.
 * @returns True when all-accounts-empty sanity violation detected.
 */
function isAllAccountsEmpty(input: IPipelineContext): boolean {
  if (!input.scrape.has) return false;
  const accounts = input.scrape.value.accounts;
  if (accounts.length === 0) return false;
  const hasAnyTxn = accounts.some((a): boolean => a.txns.length > 0);
  return !hasAnyTxn;
}

/**
 * Empty identities map sentinel — used by {@link buildAccountIdentities}
 * for the no-discovery branch.
 */
const EMPTY_IDENTITIES: ReadonlyMap<string, IAccountIdentity> = new Map();

/**
 * Build the per-card identity map SCRAPE.post emits to BALANCE-RESOLVE.
 * Pairs each iter accountId with its accountDiscovery record and
 * extracts the (cardDisplayId, cardUniqueId, bankAccountUniqueId)
 * triple. Pure data — no balance work.
 *
 * @param ids - Iter accountId list (cardDisplayId form).
 * @param records - accountDiscovery records, same order as ids.
 * @returns Per-card identity map keyed by cardDisplayId.
 */
function buildAccountIdentities(
  ids: readonly string[],
  records: readonly Record<string, unknown>[],
): ReadonlyMap<string, IAccountIdentity> {
  const out = new Map<string, IAccountIdentity>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const rec = records[i] ?? {};
    const identity = recordToIdentity(id, rec);
    out.set(id, identity);
  }
  return out;
}

/**
 * Build one identity triple from a single accountDiscovery record.
 * cardUniqueId is picked from queryId fields, bankAccountUniqueId
 * from the bankAccountUniqueId family; both fall back to the display
 * id when the record carries no internal id.
 *
 * @param displayId - Iter accountId (display form).
 * @param rec - accountDiscovery record.
 * @returns Identity triple.
 */
function recordToIdentity(displayId: string, rec: Record<string, unknown>): IAccountIdentity {
  const cardHit = findFieldValue(rec, [...WK_ACCT.queryId]);
  const cardUid = coerceStringFieldValue(cardHit);
  const bankHit = findFieldValue(rec, BANK_ACCOUNT_ID_FIELDS);
  const bankUid = coerceStringFieldValue(bankHit);
  return {
    cardDisplayId: displayId,
    cardUniqueId: cardUid !== '' ? cardUid : displayId,
    bankAccountUniqueId: bankUid !== '' ? bankUid : displayId,
  };
}

/** WK aliases for the parent bank-account id (a subset of queryId). */
const BANK_ACCOUNT_ID_FIELDS: readonly string[] = [
  'bankAccountUniqueId',
  'bankAccountUniqueID',
  'partyCurrentAccount',
];

/**
 * Coerce a findFieldValue scalar return to a non-empty string.
 * @param hit - Scalar or false.
 * @returns String form, or empty.
 */
function coerceStringFieldValue(hit: string | number | boolean): string {
  if (hit === false) return '';
  return String(hit);
}

/**
 * Discover the balance fetch template from the captured pool.
 * Inspects the request shapes SCRAPE / DASHBOARD already used and
 * picks the SMALLEST-arity per-bank-account call pattern.
 *
 * <p>Detection order:
 *   1. POST whose JSON body carries a {@link WK_ACCT.queryId} field
 *      → POST template with that field as `postBodyKey`.
 *   2. GET whose URL query carries a {@link WK_ACCT.queryId} key
 *      → GET template with `urlQueryKey`.
 *   3. GET whose URL path ends in `/<id>` where id matches any
 *      account discovery id → GET template with `urlPathInterpolation`.
 *   4. Falls back to the first POST or GET capture as a bulk
 *      template (no key).
 *
 * @param pool - All captured endpoints.
 * @param ids - accountDiscovery iter ids (used by detection 3).
 * @returns Template, or undefined when the pool is empty.
 */
function discoverBalanceFetchTemplate(
  pool: readonly IDiscoveredEndpoint[],
  ids: readonly string[],
): IBalanceFetchTemplate {
  if (pool.length === 0) return EMPTY_BALANCE_TEMPLATE;
  const postMatch = findPostTemplate(pool);
  if (postMatch.url !== '') return postMatch;
  const getQueryMatch = findGetQueryTemplate(pool);
  if (getQueryMatch.url !== '') return getQueryMatch;
  const getPathMatch = findGetPathTemplate(pool, ids);
  if (getPathMatch.url !== '') return getPathMatch;
  return findBulkTemplate(pool);
}

/** Empty template sentinel — `url === ''` means "no template found". */
const EMPTY_BALANCE_TEMPLATE: IBalanceFetchTemplate = Object.freeze({ url: '', method: 'GET' });

/**
 * Locate a POST capture whose JSON body carries a WK_ACCT.queryId
 * field and return a POST template with that field as postBodyKey.
 *
 * @param pool - Captured endpoints.
 * @returns POST template or undefined.
 */
function findPostTemplate(pool: readonly IDiscoveredEndpoint[]): IBalanceFetchTemplate {
  const templates = pool.map(tryBuildPostTemplate);
  return templates.find((t): boolean => t.url !== '') ?? EMPTY_BALANCE_TEMPLATE;
}

/**
 * Inspect one endpoint and return a POST template when its JSON body
 * carries a WK_ACCT.queryId field, else EMPTY_BALANCE_TEMPLATE.
 *
 * @param ep - One captured endpoint.
 * @returns POST template or {@link EMPTY_BALANCE_TEMPLATE}.
 */
function tryBuildPostTemplate(ep: IDiscoveredEndpoint): IBalanceFetchTemplate {
  if (ep.method !== 'POST' || ep.postData.length === 0) return EMPTY_BALANCE_TEMPLATE;
  const parsed = tryParseJsonObject(ep.postData);
  if (parsed.size === 0) return EMPTY_BALANCE_TEMPLATE;
  const key = pickQueryIdKey(parsed.record);
  if (!key) return EMPTY_BALANCE_TEMPLATE;
  return { url: urlWithoutQuery(ep.url), method: 'POST', postBodyKey: key };
}

/**
 * Locate a GET capture whose URL query carries a WK_ACCT.queryId
 * key and return a GET template with `urlQueryKey`.
 *
 * @param pool - Captured endpoints.
 * @returns GET template or undefined.
 */
function findGetQueryTemplate(pool: readonly IDiscoveredEndpoint[]): IBalanceFetchTemplate {
  const templates = pool.map(tryBuildGetQueryTemplate);
  return templates.find((t): boolean => t.url !== '') ?? EMPTY_BALANCE_TEMPLATE;
}

/**
 * Inspect one endpoint and return a GET-query template when its URL
 * query carries a WK_ACCT.queryId key, else EMPTY_BALANCE_TEMPLATE.
 *
 * @param ep - One captured endpoint.
 * @returns GET template or {@link EMPTY_BALANCE_TEMPLATE}.
 */
function tryBuildGetQueryTemplate(ep: IDiscoveredEndpoint): IBalanceFetchTemplate {
  if (ep.method !== 'GET') return EMPTY_BALANCE_TEMPLATE;
  const query = parseQueryRecord(ep.url);
  const key = pickQueryIdKey(query);
  if (!key) return EMPTY_BALANCE_TEMPLATE;
  return { url: ep.url, method: 'GET', urlQueryKey: key };
}

/**
 * Locate a GET capture whose URL path ends in `/<id>` where id is one
 * of the accountDiscovery ids.
 *
 * @param pool - Captured endpoints.
 * @param ids - Account discovery iter ids.
 * @returns GET template or undefined.
 */
function findGetPathTemplate(
  pool: readonly IDiscoveredEndpoint[],
  ids: readonly string[],
): IBalanceFetchTemplate {
  const templates = pool.map((ep): IBalanceFetchTemplate => tryBuildGetPathTemplate(ep, ids));
  return templates.find((t): boolean => t.url !== '') ?? EMPTY_BALANCE_TEMPLATE;
}

/**
 * Inspect one endpoint and return a GET-path template when its URL
 * path ends in `/<id>` where id is one of the iter accountIds.
 *
 * @param ep - One captured endpoint.
 * @param ids - Iter accountIds.
 * @returns GET template or {@link EMPTY_BALANCE_TEMPLATE}.
 */
function tryBuildGetPathTemplate(
  ep: IDiscoveredEndpoint,
  ids: readonly string[],
): IBalanceFetchTemplate {
  if (ep.method !== 'GET') return EMPTY_BALANCE_TEMPLATE;
  const pathTail = pathTailSegment(ep.url);
  if (!ids.includes(pathTail)) return EMPTY_BALANCE_TEMPLATE;
  const templateUrl = ep.url.replace(`/${pathTail}`, '/<ID>');
  return { url: templateUrl, method: 'GET', urlPathInterpolation: true };
}

/**
 * Final fallback: emit a bulk template using the first POST or GET
 * in the pool (no per-account key).
 *
 * @param pool - Captured endpoints.
 * @returns Bulk template, or {@link EMPTY_BALANCE_TEMPLATE} for empty pool.
 */
function findBulkTemplate(pool: readonly IDiscoveredEndpoint[]): IBalanceFetchTemplate {
  if (pool.length === 0) return EMPTY_BALANCE_TEMPLATE;
  const ep = pool[0];
  const method = ep.method === 'POST' ? 'POST' : 'GET';
  const url = urlWithoutQuery(ep.url);
  return { url, method };
}

/**
 * Find the first key in `rec` whose name matches any WK_ACCT.queryId
 * alias (case-insensitive).
 *
 * @param rec - Plain record.
 * @returns Matching key or empty.
 */
function pickQueryIdKey(rec: Readonly<Record<string, unknown>>): string {
  const lowerToKey = buildLowerKeyMap(rec);
  const lookups = WK_ACCT.queryId.map((alias): string => resolveOriginalKey(lowerToKey, alias));
  const match = lookups.find((k): boolean => k.length > 0);
  return match ?? '';
}

/**
 * Resolve the original-case key for a lowercase WK alias, returning
 * empty when not present. Hoisted so {@link pickQueryIdKey} stays
 * inside its `.map()` callback at depth 1.
 *
 * @param lowerToKey - Lowercase → original key lookup.
 * @param alias - WK_ACCT.queryId alias to resolve.
 * @returns Original-case key, or empty string.
 */
function resolveOriginalKey(lowerToKey: Map<string, string>, alias: string): string {
  const lowerAlias = alias.toLowerCase();
  return lowerToKey.get(lowerAlias) ?? '';
}

/**
 * Build a lowercase-key → original-key lookup so {@link pickQueryIdKey}
 * stays at depth 1 (max-depth rule).
 *
 * @param rec - Plain record.
 * @returns Lookup map.
 */
function buildLowerKeyMap(rec: Readonly<Record<string, unknown>>): Map<string, string> {
  const out = new Map<string, string>();
  /**
   * Add a single lowercase→original entry to the lookup.
   * @param k - Original key.
   * @returns Updated lookup map.
   */
  const setEntry = (k: string): Map<string, string> => {
    const lowerK = k.toLowerCase();
    return out.set(lowerK, k);
  };
  Object.keys(rec).forEach(setEntry);
  return out;
}

/** Result wrapper for {@link tryParseJsonObject}. */
interface IJsonParseResult {
  readonly size: number;
  readonly record: Readonly<Record<string, unknown>>;
}

const EMPTY_JSON_PARSE: IJsonParseResult = Object.freeze({ size: 0, record: Object.freeze({}) });

/**
 * Narrow a JSON.parse result to a record. Arrays / nulls / primitives
 * collapse to the empty sentinel so {@link tryParseJsonObject} stays
 * flat (max-depth ≤ 1).
 *
 * @param parsed - JSON.parse result.
 * @returns Wrapped record (size=0 ⇒ non-object).
 */
function narrowParsedToResult(parsed: unknown): IJsonParseResult {
  if (parsed === null) return EMPTY_JSON_PARSE;
  if (typeof parsed !== 'object') return EMPTY_JSON_PARSE;
  if (Array.isArray(parsed)) return EMPTY_JSON_PARSE;
  const record = parsed as Record<string, unknown>;
  return { size: Object.keys(record).length || 1, record };
}

/**
 * Try to parse a JSON string and narrow to a plain object record.
 * @param raw - JSON string.
 * @returns Wrapped record + size (size=0 ⇒ parse failed or non-object).
 */
function tryParseJsonObject(raw: string): IJsonParseResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    return narrowParsedToResult(parsed);
  } catch {
    return EMPTY_JSON_PARSE;
  }
}

/**
 * Parse the URL query string into a flat record.
 * @param url - URL.
 * @returns Query record.
 */
function parseQueryRecord(url: string): Record<string, string> {
  try {
    return populateQueryRecord(new URL(url));
  } catch {
    return {};
  }
}

/**
 * Populate a flat record from a parsed URL's searchParams.
 *
 * @param u - Parsed URL.
 * @returns Flat record of query params.
 */
function populateQueryRecord(u: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of u.searchParams.entries()) out[k] = v;
  return out;
}

/**
 * Extract the last URL path segment (the bit after the final `/` and
 * before any query string). Used by GET-path template detection.
 *
 * @param url - URL.
 * @returns Last path segment (after final `/`, before `?`).
 */
function pathTailSegment(url: string): string {
  const qIdx = url.indexOf('?');
  const noQuery = qIdx < 0 ? url : url.slice(0, qIdx);
  const slashIdx = noQuery.lastIndexOf('/');
  return slashIdx < 0 ? noQuery : noQuery.slice(slashIdx + 1);
}

/**
 * Strip the query string off a URL, returning the path-only prefix.
 *
 * @param url - URL.
 * @returns URL without the query string.
 */
function urlWithoutQuery(url: string): string {
  const i = url.indexOf('?');
  return i < 0 ? url : url.slice(0, i);
}

/**
 * SCRAPE.post (v6) — stamp account count + emit BALANCE-RESOLVE
 * inputs onto scrape state.
 *
 * <p>Emits {@link IAccountIdentity} triples per iter accountId
 * (from accountDiscovery) and the {@link IBalanceFetchTemplate}
 * derived from the captured pool. BALANCE-RESOLVE.pre will
 * consume both and plan per-bank-account fetches.
 *
 * <p>No balance work in this phase — single-phase ownership rule
 * (general-phases-view-guidlines.md). When accountDiscovery or
 * mediator is absent (test paths), the v6 fields stay undefined.
 *
 * @param input - Pipeline context with scrape state.
 * @returns Updated context with diagnostics + identities + template.
 */
function executeStampAccounts(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const count = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const label = `scrape-final (${String(count)} accounts)`;
  const diag = { ...input.diagnostics, lastAction: label };
  if (!input.scrape.has) {
    const noScrapeNext = succeed({ ...input, diagnostics: diag });
    return Promise.resolve(noScrapeNext);
  }
  const identities = buildIdentitiesForScrape(input);
  const template = buildTemplateForScrape(input);
  const hasIdentities = identities.size > 0;
  const hasTemplate = template.url !== '';
  const scrapeWithEmit = some({
    ...input.scrape.value,
    accountIdentities: hasIdentities ? identities : undefined,
    balanceFetchTemplate: hasTemplate ? template : undefined,
  });
  const next = succeed({ ...input, diagnostics: diag, scrape: scrapeWithEmit });
  return Promise.resolve(next);
}

/**
 * Read accountDiscovery and build the identity map. Returns the
 * empty sentinel when accountDiscovery is absent.
 *
 * @param input - Pipeline context.
 * @returns Identity map.
 */
function buildIdentitiesForScrape(input: IPipelineContext): ReadonlyMap<string, IAccountIdentity> {
  if (!input.accountDiscovery.has) return EMPTY_IDENTITIES;
  const { ids, records } = input.accountDiscovery.value;
  return buildAccountIdentities(ids, records);
}

/**
 * Read network captures and discover the balance fetch template.
 * Returns undefined when mediator absent or no template candidate
 * found.
 *
 * @param input - Pipeline context.
 * @returns Template or undefined.
 */
function buildTemplateForScrape(input: IPipelineContext): IBalanceFetchTemplate {
  if (!input.mediator.has) return EMPTY_BALANCE_TEMPLATE;
  const pool = input.mediator.value.network.getAllEndpoints();
  const ids = input.accountDiscovery.has ? input.accountDiscovery.value.ids : [];
  return discoverBalanceFetchTemplate(pool, ids);
}

export { executeForensicPre, executeMatrixLoop, executeStampAccounts, executeValidateResults };
