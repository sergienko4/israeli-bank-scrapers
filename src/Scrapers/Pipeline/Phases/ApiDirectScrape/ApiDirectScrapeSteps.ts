/**
 * Per-step fetch orchestration for the ApiDirectScrape phase driver.
 * Consumes dispatch-args builders from ApiDirectScrapeDispatchArgs and
 * dispatchStep from ApiDirectScrapeDispatch; walks customer → balance →
 * paginated transactions. Zero bank-name coupling.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  ICoverageResult,
  OwnsRow,
} from '../../Mediator/Scrape/CoverageAudit/CoverageAudit.js';
import {
  auditCoverage,
  OWNS_EVERY_ROW,
} from '../../Mediator/Scrape/CoverageAudit/CoverageAudit.js';
import { auditDeclaredRows } from '../../Mediator/Scrape/CoverageAudit/DeclaredRows.js';
import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { Brand } from '../../Types/Brand.js';
import { toError } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { dispatchStep } from './ApiDirectScrapeDispatch.js';
import {
  buildBalanceDispatchArgs,
  buildCustomerDispatchArgs,
  buildTxnsDispatchArgs,
  type IAcctCtx,
  type IDriverCtx,
  resolveSecondaryUrlTag,
} from './ApiDirectScrapeDispatchArgs.js';
import type { ApiBody, IBalanceOutcome } from './IApiDirectScrapeShape.js';

/** Stop signal — branded so Rule #15 accepts the boolean return. */
type ShouldStop = Brand<boolean, 'GenericHeadlessShouldStop'>;

/** Empty body passed to a step's extractor when it skips the fetch. */
const EMPTY_BODY = Object.freeze({});

/**
 * Fetch the optional secondary identity GET declared by
 * `customer.secondaryUrlTag`; yields EMPTY_BODY when none is declared so
 * `extractAccounts` always receives a defined `secondaryBody`.
 * @param d - Driver context.
 * @returns Secondary identity body procedure.
 */
async function fetchSecondaryBody<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<ApiBody>> {
  const tag = resolveSecondaryUrlTag(d);
  if (tag === false) return succeed<ApiBody>(EMPTY_BODY);
  return d.bus.apiGet<ApiBody>(tag);
}

/**
 * Run a shape's `extractAccounts` and convert a throw into a typed failure.
 *
 * <p>Shapes reject an unusable account identity by throwing (see the FIBI
 * group factory). An escaping exception would bypass
 * `runScrapeWithRecovery`, so a warm session serving a degraded identity
 * body would abort the scrape instead of re-logging in and retrying. A
 * failed `Procedure` is what `isScrapeSuspicious` reads, so converting here
 * keeps the documented recover-once path reachable and honours the
 * Result-Pattern contract every other step in this module follows.
 * @param d - Driver context.
 * @param body - Primary customer-fetch body.
 * @param secondaryBody - Secondary identity body.
 * @returns Account refs procedure.
 */
function runExtract<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  body: ApiBody,
  secondaryBody: ApiBody,
): Procedure<readonly TAcct[]> {
  const sessionContext = d.bus.getSessionContext();
  try {
    const accts = d.shape.customer.extractAccounts({ body, secondaryBody, sessionContext });
    return succeed(accts);
  } catch (error) {
    const message = toError(error).message;
    return fail(ScraperErrorTypes.Generic, `extractAccounts threw: ${message}`);
  }
}

/**
 * Run `extractAccounts` against a primary body plus the optional
 * secondary-identity body and the post-login session-context.
 * @param d - Driver context.
 * @param body - Primary customer-fetch body (EMPTY_BODY when skipped).
 * @returns Account refs procedure.
 */
async function extractAccts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  body: ApiBody,
): Promise<Procedure<readonly TAcct[]>> {
  const secondary = await fetchSecondaryBody(d);
  if (!isOk(secondary)) return secondary;
  return runExtract(d, body, secondary.value);
}

/**
 * Fetch customer tree and extract the flat account list. Honours
 * `customer.skipFetch === true` by bypassing the network call, and
 * `customer.secondaryUrlTag` by folding a second identity GET into
 * `extractAccounts` as `secondaryBody`.
 * @param d - Driver context.
 * @returns Account refs procedure.
 */
export async function fetchAccounts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<readonly TAcct[]>> {
  if (d.shape.customer.skipFetch === true) return extractAccts(d, EMPTY_BODY);
  const dispatchArgs = buildCustomerDispatchArgs(d);
  const resp = await dispatchStep(dispatchArgs);
  if (!isOk(resp)) return resp;
  return extractAccts(d, resp.value);
}

/**
 * Fetch one account's balance, honouring fallbackOnFail when set.
 * @param a - Per-account context.
 * @returns Balance outcome procedure (value + degraded flag).
 */
export async function fetchBalance<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): Promise<Procedure<IBalanceOutcome>> {
  if (a.shape.balance.skipFetch === true) {
    return succeed({ value: a.shape.balance.extract(EMPTY_BODY), degraded: false });
  }
  const dispatchArgs = buildBalanceDispatchArgs(a);
  const resp = await dispatchStep(dispatchArgs);
  if (isOk(resp)) return succeed({ value: a.shape.balance.extract(resp.value), degraded: false });
  const fb = a.shape.balance.fallbackOnFail;
  if (fb === undefined) return resp;
  return succeed({ value: fb, degraded: true });
}

/** Page fetcher signature consumed by fetchPaginated. */
type PageFetcher<TCursor> = (cursor: TCursor | false) => Promise<Procedure<IPage<object, TCursor>>>;

/**
 * Bind a shape's declared row-ownership test to the account being audited.
 *
 * Only a shape whose response carries every account merged declares one. For
 * the rest the audit's own default applies, and returning it here rather than
 * nothing keeps a single definition of what "this row is mine" means.
 *
 * @param a - Per-account context.
 * @returns The bound test, or the every-row default when none is declared.
 */
function ownsRowFor<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): OwnsRow {
  const declared = a.shape.transactions.auditOwnsRow;
  if (!declared) return OWNS_EVERY_ROW;
  return (row: object): boolean => declared(row, a.acct);
}

/**
 * Reconcile one page: compare the rows the bank shape returned against every
 * transaction discoverable in the same response body.
 *
 * Runs on every page of every bank because the defect it catches is a
 * provider-side change — a container added or renamed upstream — which no
 * amount of care in our own code prevents. It reports and returns; the page
 * is passed through untouched.
 *
 * A shape whose response carries every account merged declares `auditOwnsRow`;
 * bound to this account by {@link ownsRowFor} it narrows hunted rows to the
 * ones this account owns. Without it the other accounts' rows would read as
 * loss on every page. Banks with a per-account response declare nothing.
 *
 * @param a - Per-account context.
 * @param body - Raw response body for this page.
 * @param items - Rows the shape extracted from that body.
 * @returns Coverage counts for the page.
 */
function auditPageCoverage<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  body: ApiBody,
  items: readonly object[],
): ICoverageResult {
  const label = `${a.ctx.companyId}/txns`;
  const isCardIssuer = a.shape.isCardIssuer;
  const ownsRow = ownsRowFor(a);
  return auditCoverage({ body, extracted: items, isCardIssuer, label, ownsRow });
}

/**
 * Reconcile one page against the counts the provider itself declared.
 *
 * Complements {@link auditPageCoverage}: that audit hunts the body and can be
 * argued with, this one quotes the provider back at itself and cannot. Runs
 * only for banks whose response carries such a count.
 *
 * @param a - Per-account context.
 * @param body - Raw response body for this page.
 * @returns True once the check has reported.
 */
function auditPageDeclared<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>, body: ApiBody): true {
  const specs = a.shape.transactions.declaredRowSpecs ?? [];
  const label = `${a.ctx.companyId}/txns`;
  auditDeclaredRows({ body, specs, label });
  return true;
}

/**
 * Run both guardrails over one fetched page.
 *
 * Kept together because they answer the same question from opposite ends —
 * one re-reads the body to find rows the shape never returned, the other
 * checks the count the provider itself declared. Neither repairs anything.
 *
 * @param a - Per-account context.
 * @param body - Raw response body for this page.
 * @param items - Rows the shape extracted from it.
 * @returns True once both checks have reported.
 */
function auditPage<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  body: ApiBody,
  items: readonly object[],
): true {
  auditPageCoverage(a, body, items);
  return auditPageDeclared(a, body);
}

/**
 * Extract one page from a response body and run both coverage guardrails.
 *
 * Extraction and auditing are bound together so no caller can obtain a page
 * without the audit having run against the body that produced it.
 *
 * @param a - Per-account context.
 * @param body - Raw response body for this round.
 * @param cursor - Cursor that produced this round, or false on the first call.
 * @returns The extracted page.
 */
function extractAudited<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  body: ApiBody,
  cursor: TCursor | false,
): IPage<object, TCursor> {
  const args = { body, cursor, acct: a.acct, ctx: a.ctx };
  const page = a.shape.transactions.extractPage(args);
  auditPage(a, body, page.items);
  return page;
}

/**
 * Run one paginated fetch + extract round for a given cursor.
 * @param a - Per-account context.
 * @param cursor - Cursor for the round, or false on the first call.
 * @returns Procedure with the extracted page.
 */
async function runPageFetch<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  cursor: TCursor | false,
): Promise<Procedure<IPage<object, TCursor>>> {
  const dispatchArgs = buildTxnsDispatchArgs(a, cursor);
  const resp = await dispatchStep(dispatchArgs);
  if (!isOk(resp)) return resp;
  const page = extractAudited(a, resp.value, cursor);
  return succeed(page);
}

/**
 * Build the page fetcher closure for one account.
 * @param a - Per-account context.
 * @returns Bound page fetcher consumed by fetchPaginated.
 */
export function buildPageFetcher<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): PageFetcher<TCursor> {
  return (cursor): Promise<Procedure<IPage<object, TCursor>>> => runPageFetch(a, cursor);
}

/** Stop predicate signature consumed by fetchPaginated. */
type BoundStop = (acc: readonly object[]) => ShouldStop;

/**
 * No-op stop predicate — used when the shape omits a custom stop.
 * @returns False (never stop).
 */
function neverStop(): ShouldStop {
  return false as ShouldStop;
}

/**
 * Bind the shape's stop predicate to action context; default to neverStop.
 * @param d - Driver context.
 * @returns fetchPaginated-compatible stop predicate.
 */
export function buildStop<TAcct, TCursor>(d: IDriverCtx<TAcct, TCursor>): BoundStop {
  const stop = d.shape.transactions.stop;
  if (!stop) return neverStop;
  return (acc): ShouldStop => stop(acc, d.ctx) as ShouldStop;
}
