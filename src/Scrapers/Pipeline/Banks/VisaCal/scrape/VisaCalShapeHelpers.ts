/**
 * VisaCal scrape shape — card list + balance extractors + the customer
 * POST body/URL for the CAL API gateway. Transactions helpers live in
 * VisaCalShapeTxns.ts. balanceKind=card-cycle (no account-level balance
 * call — `balance.skipFetch` returns a deterministic 0); auth=token
 * (the Bearer/CALAuthScheme value is primed onto the mediator by the
 * BIND-API-MEDIATOR phase, so nothing auth-related is declared here).
 *
 * Grounded in the VisaCal network trace: customer =
 * POST /Authentication/api/account/init body {"tokenGuid":""} →
 * result.cards[]. Raw card-transaction rows normalise downstream via
 * PIPELINE_WELL_KNOWN_TXN_FIELDS (the Data Mapper) — never in the shape.
 */

import type {
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';

/** CAL API gateway origin — VisaCal's fixed API-contract host. */
export const CAL_API = 'https://api.cal-online.co.il';

/** Card display number (last-4) — branded for Rule #15. */
type CardNumberDisplay = Brand<string, 'VisaCalCardNumberDisplay'>;

/**
 * VisaCal card reference. `cardUniqueId` is the CAL API query id sent as
 * the per-card transactions POST body param; `displayNumber` (last-4) is
 * the user-facing card number.
 */
export interface IVisaCalCard {
  readonly cardUniqueId: string;
  readonly displayNumber: string;
}

interface IRawCard {
  readonly cardUniqueId?: string;
  readonly last4Digits?: string;
}
interface ICustomerResp {
  readonly result?: { readonly cards?: readonly IRawCard[] };
}

/**
 * Map one raw account/init card to a card reference.
 * @param c - Raw card entry from result.cards[].
 * @returns Card reference (query id + display number).
 */
function toCard(c: IRawCard): IVisaCalCard {
  const cardUniqueId = c.cardUniqueId ?? '';
  return { cardUniqueId, displayNumber: c.last4Digits ?? cardUniqueId };
}

/**
 * Flatten result.cards[] into card references.
 * @param args - Extract-args bundle (reads args.body only).
 * @returns Card list (empty when the container is absent).
 */
export function extractCards(args: IExtractAccountsArgs): readonly IVisaCalCard[] {
  const resp = args.body as unknown as ICustomerResp;
  const rows = resp.result?.cards ?? [];
  return rows.map(toCard);
}

/**
 * User-facing card number (last-4, falling back to the query id).
 * @param card - VisaCal card.
 * @returns Display number.
 */
export function accountNumberOf(card: IVisaCalCard): CardNumberDisplay {
  return card.displayNumber as CardNumberDisplay;
}

/**
 * Customer POST body — the account/init envelope opener {"tokenGuid":""}.
 * @returns Customer request body.
 */
export function customerVars(): VarsMap {
  return { tokenGuid: '' };
}

/**
 * Customer URL — the static account/init endpoint (returns the card list).
 * @returns Literal CAL account/init URL.
 */
export function customerUrl(): WKUrlOrLiteral {
  return literalUrl(`${CAL_API}/Authentication/api/account/init`);
}

/**
 * No-op variables builder — the balance step never fetches (skipFetch).
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
}
