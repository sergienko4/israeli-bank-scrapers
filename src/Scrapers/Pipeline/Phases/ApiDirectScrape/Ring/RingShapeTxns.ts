/**
 * Ring scrape shape — transactions. The ring app reads a card month through
 * `GatewayV2`, which wraps the same `GetTransactionsList` request the web
 * site sends (`Data`, unchanged) under a `serviceUrl`. The month walk is the
 * shared card-issuer calendar: `01/MM/YYYY` from the window start, one month
 * per cursor step.
 */

import type { IRingConstants } from '../../../Registry/Config/PipelineBankConfigRingConstants.js';
import { type LiteralUrl, literalUrl } from '../../../Registry/WK/UrlsWK.js';
import type { IPage } from '../../../Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import {
  billingMonthAt,
  lastOffset,
  nextCursorOf,
  offsetOf,
} from '../CardIssuer/CardIssuerShapeTxns.js';
import type { IExtractPageArgs, VarsMap } from '../IApiDirectScrapeShape.js';
import type { IRingCard } from './RingShapeCards.js';
import { mergeRingRows } from './RingShapeExtract.js';

/**
 * The gateway route every ring issuer uses. The leading `11` is a route
 * segment, not the company code: an Amex card (company 77) is asked on this
 * same route, with its own code in `Data.companyCode`.
 */
const TXNS_SERVICE_URL = '11/v3-transactions/v1.1.0/GetTransactionsList';

/**
 * The GetTransactionsList request for one card month.
 * @param card - Ring card.
 * @param billingMonth - `01/MM/YYYY`.
 * @returns Request data.
 */
function txnData(card: IRingCard, billingMonth: string): VarsMap {
  return {
    card4Number: card.card4Number,
    isNextBillingDate: true,
    cardStatus: 0,
    billingMonth,
    companyCode: card.companyCode,
    isPartner: false,
  };
}

/**
 * The GatewayV2 body for one card month (transactions and balance).
 * @param card - Ring card.
 * @param billingMonth - `01/MM/YYYY`.
 * @returns `{serviceUrl, Data}` body.
 */
export function gatewayBody(card: IRingCard, billingMonth: string): VarsMap {
  return { serviceUrl: TXNS_SERVICE_URL, Data: txnData(card, billingMonth) };
}

/**
 * The GatewayV2 endpoint for one ring issuer.
 * @param ring - The issuer's ring constants.
 * @returns Literal GatewayV2 URL.
 */
export function gatewayUrl(ring: IRingConstants): LiteralUrl {
  return literalUrl(`${ring.base}/GatewayV2`);
}

/**
 * The transactions body for the cursor's billing month.
 * @param card - Ring card.
 * @param cursor - Month offset from the window start, or false for the first.
 * @param ctx - Action context (window options).
 * @returns GatewayV2 body.
 */
export function txnsVars(card: IRingCard, cursor: number | false, ctx: IActionContext): VarsMap {
  const offset = offsetOf(cursor);
  const billingMonth = billingMonthAt(ctx, offset);
  return gatewayBody(card, billingMonth);
}

/**
 * Extract one month's rows and the next month cursor.
 * @param args - Response body, cursor, card and context.
 * @returns Page of merged rows.
 */
export function txnsExtractPage(args: IExtractPageArgs<IRingCard, number>): IPage<object, number> {
  const rows = mergeRingRows(args.body);
  const offset = offsetOf(args.cursor);
  const ceiling = lastOffset(args.ctx);
  const nextCursor = nextCursorOf(offset, ceiling);
  return { items: rows, nextCursor };
}
