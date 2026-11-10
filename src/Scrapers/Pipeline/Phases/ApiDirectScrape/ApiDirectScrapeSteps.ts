/**
 * Per-step fetch orchestration for the ApiDirectScrape phase driver.
 * Consumes dispatch-args builders from ApiDirectScrapeDispatchArgs and
 * dispatchStep from ApiDirectScrapeDispatch; walks customer → balance →
 * paginated transactions. Zero bank-name coupling.
 */

import type { IPage } from '../../Strategy/Fetch/Pagination.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { applyBodyChecks, dispatchStep, omitBankResponseText } from './ApiDirectScrapeDispatch.js';
import {
  buildCustomerDispatchArgs,
  buildSecondaryOpts,
  buildTxnsDispatchArgs,
} from './ApiDirectScrapeDispatchArgs.js';
import reportExcludedProducts from './ApiDirectScrapeExclusions.js';
import auditPage from './ApiDirectScrapePageAudit.js';
import type { IAcctCtx, IDriverCtx } from './ApiDirectScrapeTypes.js';
import { resolveSecondaryUrlTag } from './ApiDirectScrapeUrlTags.js';
import type { ApiBody, IExtractAccountsArgs } from './IApiDirectScrapeShape.js';
import { guardShape } from './ShapeGuard.js';

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
  const opts = buildSecondaryOpts(d);
  const response = await d.bus.apiGet<ApiBody>(tag, opts);
  return checkSecondaryBody(d, response);
}

/**
 * Sanitise and check the secondary identity response.
 * @param d - Driver context.
 * @param response - The secondary identity GET result.
 * @returns The checked body, or the first refusal.
 */
function checkSecondaryBody<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  response: Procedure<ApiBody>,
): Procedure<ApiBody> {
  const answered = omitBankResponseText(response, 'customer', d.shape.omitBankText);
  const selected = d.shape.checkBodyByOperation?.['customer-secondary'];
  return applyBodyChecks(answered, d.shape.checkBody, selected);
}

/**
 * Extract the account list, then report anything the shape filtered out.
 *
 * <p>Shapes reject an unusable account identity by throwing (see the FIBI
 * group factory). {@link guardShape} converts that throw into the failed
 * `Procedure` `isScrapeSuspicious` reads, which is what keeps the documented
 * recover-once path reachable.
 *
 * <p>The reporting call sits OUTSIDE the guard deliberately: only
 * `extractAccounts` may be blamed for its own throw, and
 * `reportExcludedProducts` is total, so diagnostics cannot change the
 * outcome of a scrape that already succeeded.
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
  const args = { body, secondaryBody, sessionContext: d.bus.getSessionContext() };
  const extracted = guardShape('extractAccounts', () => d.shape.customer.extractAccounts(args));
  return reportExtracted(d, args, extracted);
}

/**
 * Report the products the shape filtered out, then pass the extraction on.
 * @param d - Driver context.
 * @param args - Extract-args bundle.
 * @param extracted - Result of the guarded extraction.
 * @returns The extraction, unchanged.
 */
function reportExtracted<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  args: IExtractAccountsArgs,
  extracted: Procedure<readonly TAcct[]>,
): Procedure<readonly TAcct[]> {
  if (!isOk(extracted)) return extracted;
  reportExcludedProducts(d, args, extracted.value.length);
  return extracted;
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

/** Page fetcher signature consumed by fetchPaginated. */
type PageFetcher<TCursor> = (cursor: TCursor | false) => Promise<Procedure<IPage<object, TCursor>>>;

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
): Procedure<IPage<object, TCursor>> {
  const guarded = guardedPage(a, body, cursor);
  if (!isOk(guarded)) return guarded;
  auditPage(a, body, guarded.value.items);
  return guarded;
}

/**
 * Run the shape's page extractor behind the guarded boundary.
 * @param a - Per-account context.
 * @param body - Raw response body for this round.
 * @param cursor - Cursor that produced this round, or false on the first call.
 * @returns The extracted page, or the guard's typed failure.
 */
function guardedPage<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  body: ApiBody,
  cursor: TCursor | false,
): Procedure<IPage<object, TCursor>> {
  const args = { body, cursor, acct: a.acct, ctx: a.ctx, ledger: a.ledger };
  return guardShape('transactions.extractPage', () => a.shape.transactions.extractPage(args));
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
  return extractAudited(a, resp.value, cursor);
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
type BoundStop = (acc: readonly object[]) => Procedure<boolean>;

/**
 * No-op stop predicate — used when the shape omits a custom stop.
 * @returns A successful false (never stop).
 */
function neverStop(): Procedure<boolean> {
  return succeed(false);
}

/**
 * Bind the shape's stop predicate to action context; default to neverStop.
 * @param d - Driver context.
 * @returns fetchPaginated-compatible stop predicate.
 */
export function buildStop<TAcct, TCursor>(d: IDriverCtx<TAcct, TCursor>): BoundStop {
  const stop = d.shape.transactions.stop;
  if (!stop) return neverStop;
  return (acc): Procedure<boolean> => guardShape('transactions.stop', () => stop(acc, d.ctx));
}
