/**
 * Massad (FIBI group) scrape shape — transactions helpers. A single POST
 * to `bff-balancetransactions/api/v1/transactions/list` with the account
 * number (numeric), account type, branch, and the scrape date window in an
 * `initialRequest` envelope. The captured trace returned the full window
 * in one page, so the cursor is terminal (`never`) — matching the
 * Hapoalim/Leumi single-page precedent. Raw rows flow downstream to the
 * field-mapping Data Mapper unchanged (amount = creditAmount −
 * debitAmount, date from dateOfRegistration).
 *
 * Contract shared with Beinleumi (same FIBI Mataf portal); cloned per the
 * zero-cross-bank-import convention. Split from MassadShapeHelpers.ts to
 * respect the 150-LOC ceiling.
 */

import moment from 'moment';

import type {
  IExtractPageArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { BFF_BASE, type IMassadAcct, MASSAD_API } from './MassadShapeHelpers.js';

/** Transaction date format (YYYY-MM-DD, per the captured POST body). */
const TXN_DATE_FMT = 'YYYY-MM-DD';
/** Fixed sort order (ascending) the endpoint expects. */
const TXN_ORDER = 1;
/** Fixed response language code. */
const TXN_LANGUAGE = 'HEB';

type MassadTxn = Record<string, unknown>;

interface ITxnsResp {
  readonly transactions?: readonly MassadTxn[];
}

/**
 * Window start date (YYYY-MM-DD from ScraperOptions.startDate).
 * @param ctx - Action context.
 * @returns Formatted startDate.
 */
function startOf(ctx: IActionContext): string {
  return moment(ctx.options.startDate).format(TXN_DATE_FMT);
}

/**
 * Window end date (YYYY-MM-DD — today).
 * @returns Formatted endDate.
 */
function endOf(): string {
  return moment().format(TXN_DATE_FMT);
}

/**
 * Build the `initialRequest` envelope — account number is numeric on the
 * wire; branch is a string; dates span the scrape window.
 * @param acct - Massad account.
 * @param ctx - Action context (carries startDate).
 * @returns Wire request payload.
 */
function buildInitialRequest(acct: IMassadAcct, ctx: IActionContext): VarsMap {
  return {
    accountNumber: Number(acct.accountNumber),
    accountType: acct.accountType,
    branch: acct.branch,
    startDate: startOf(ctx),
    endDate: endOf(),
    order: TXN_ORDER,
    language: TXN_LANGUAGE,
  };
}

/**
 * Transactions URL — the fixed BFF list endpoint (params ride the body).
 * @returns Literal list URL.
 */
export function txnsUrl(): WKUrlOrLiteral {
  return literalUrl(`${MASSAD_API}${BFF_BASE}/list`);
}

/**
 * Transactions POST body — the `initialRequest` envelope.
 * @param acct - Massad account.
 * @param _cursor - Unused (single full-window call).
 * @param ctx - Action context (carries startDate).
 * @returns Variables map POSTed as the JSON body.
 */
export function txnsVars(acct: IMassadAcct, _cursor: false, ctx: IActionContext): VarsMap {
  return { initialRequest: buildInitialRequest(acct, ctx) };
}

/**
 * Extract the single transactions page — raw rows, no next cursor (the
 * full-window call returns the whole range).
 * @param args - Bundle carrying the unwrapped response body.
 * @returns Page rows + terminal cursor.
 */
export function txnsExtractPage(args: IExtractPageArgs<IMassadAcct, never>): IPage<object, never> {
  const resp = args.body as unknown as ITxnsResp;
  return { items: resp.transactions ?? [], nextCursor: false };
}
