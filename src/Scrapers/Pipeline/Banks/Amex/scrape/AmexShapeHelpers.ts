/**
 * Amex scrape shape — card-list extractor + the customer POST body/URL for
 * the DigitalV3 transactions API. Transactions helpers live in
 * AmexShapeTxns.ts; response row-merging in AmexShapeExtract.ts.
 * balanceKind=card-cycle (no account-level balance — `balance.skipFetch`
 * yields a deterministic 0); auth=session-cookie (the WAF-bypassing browser
 * login's first-party cookies ride BrowserFetchStrategy, so nothing
 * auth-related is declared here).
 *
 * Grounded in the Amex network trace: customer =
 * POST /ocp/transactions/DigitalV3.Transactions/GetCardList body
 * {"companyCode":"99","cardSuffixLength":4} → data.cardsList (a
 * STRING-encoded JSON array in production) → per-card {cardSuffix,
 * companyCode}. Raw transaction rows normalise downstream via
 * PIPELINE_WELL_KNOWN_TXN_FIELDS (the Data Mapper) — never in the shape.
 */

import type {
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { type LiteralUrl, literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';

/** Amex DigitalV3 API origin — the post-login SPA host (web, not www). */
export const AMEX_API = 'https://web.americanexpress.co.il';

/** GetCardList query companyCode — a fixed catalog code, not per-card. */
const QUERY_COMPANY_CODE = '99';

/** Card display number (last-4) — branded for Rule #15. */
type CardNumberDisplay = Brand<string, 'AmexCardNumberDisplay'>;

/**
 * Amex card reference. `cardSuffix` (last-4) is sent as the per-card
 * transactions `card4Number`; `companyCode` selects the issuing brand
 * (e.g. 77, 11) in the transactions body — distinct from the fixed "99"
 * GetCardList query code.
 */
export interface IAmexCard {
  readonly cardSuffix: string;
  readonly companyCode: string;
}

interface IRawCard {
  readonly cardSuffix?: string;
  readonly companyCode?: string | number;
}
interface ICustomerData {
  readonly cardsList?: string | readonly IRawCard[];
}
interface ICustomerResp {
  readonly data?: ICustomerData;
}

/**
 * JSON.parse a string-encoded cardsList; return [] on parse failure or a
 * non-array payload.
 * @param raw - String-encoded JSON array.
 * @returns Raw card rows.
 */
function safeParseCards(raw: string): readonly IRawCard[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as readonly IRawCard[]) : [];
  } catch {
    return [];
  }
}

/**
 * Parse the production string-encoded cardsList (or pass an array through)
 * into raw card rows. Tolerates a malformed string by yielding no cards.
 * @param raw - cardsList value (string in production, array defensively).
 * @returns Raw card rows.
 */
function parseCardsList(raw?: string | readonly IRawCard[]): readonly IRawCard[] {
  if (raw === undefined) return [];
  if (typeof raw === 'string') return safeParseCards(raw);
  return raw;
}

/**
 * Map one raw card to a card reference. `companyCode` is kept as a string;
 * the transactions body coerces it to the numeric wire form.
 * @param c - Raw card entry from cardsList.
 * @returns Card reference.
 */
function toCard(c: IRawCard): IAmexCard {
  const companyCode = c.companyCode ?? '';
  return { cardSuffix: c.cardSuffix ?? '', companyCode: String(companyCode) };
}

/**
 * Flatten data.cardsList (string-encoded in production) into card refs.
 * @param args - Extract-args bundle (reads args.body only).
 * @returns Card list (empty when the container is absent/malformed).
 */
export function extractCards(args: IExtractAccountsArgs): readonly IAmexCard[] {
  const resp = args.body as unknown as ICustomerResp;
  const rows = parseCardsList(resp.data?.cardsList);
  return rows.map(toCard);
}

/**
 * User-facing card number (last-4).
 * @param card - Amex card.
 * @returns Display number.
 */
export function accountNumberOf(card: IAmexCard): CardNumberDisplay {
  return card.cardSuffix as CardNumberDisplay;
}

/**
 * Customer POST body — the fixed GetCardList query
 * {companyCode:"99", cardSuffixLength:4}.
 * @returns Customer request body.
 */
export function customerVars(): VarsMap {
  return { companyCode: QUERY_COMPANY_CODE, cardSuffixLength: 4 };
}

/**
 * Customer URL — the static GetCardList endpoint (returns the card list).
 * @returns Literal Amex GetCardList URL.
 */
export function customerUrl(): WKUrlOrLiteral {
  return literalUrl(`${AMEX_API}/ocp/transactions/DigitalV3.Transactions/GetCardList`);
}

/**
 * Prime route — the Amex transactions SPA frontend. Navigating here
 * post-login establishes the transactions-service session (SSO cookie +
 * referer + InitContent bootstrap) so GetCardList / GetTransactionsList
 * return 200 instead of 302→login. Grounded in the generic-DASHBOARD
 * trace, which navigates this exact route and logs `primed:true`. Typed
 * as the branded {@link LiteralUrl} (⊆ string) so it satisfies both the
 * nominal-return architecture rule and the `navUrl: (ctx) => string`
 * shape contract.
 * @returns Amex transactions SPA route.
 */
export function primeUrl(): LiteralUrl {
  return literalUrl(`${AMEX_API}/transactions`);
}

/**
 * No-op variables builder — the balance step never fetches (skipFetch).
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
}
