/**
 * VisaCal scrape shape — card list extractor + the customer POST body/URL
 * for the CAL web gateway. Balance helpers live in VisaCalShapeBalance.ts,
 * transactions helpers in VisaCalShapeTxns.ts. auth=token (the login flow
 * installs the `CALAuthScheme` Authorization, so nothing auth-related is
 * declared here).
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

/** Site identifier CAL's own web app sends to the API gateway. */
export const CAL_WEB_SITE_ID = '09031987-273E-2311-906C-8AF85B17C8D9';

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
