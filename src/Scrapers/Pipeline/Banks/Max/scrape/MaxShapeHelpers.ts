/**
 * Max scrape shape — card-list extractor + the getHomePageData customer GET
 * URL, plus the shared client-version reader both steps use to append Max's
 * SPA build-version `?v=` param (discovered at BIND-API-MEDIATOR).
 * balanceKind=card-cycle (no account balance — `balance.skipFetch` yields 0);
 * auth=session-cookie (the WAF-bypassing browser login's first-party cookies
 * ride BrowserFetchStrategy). Transactions helpers live in MaxShapeTxns.ts;
 * row filtering in MaxShapeExtract.ts.
 *
 * Grounded in the Max trace: customer =
 * GET /api/registered/getHomePageData?disableDefaultSpinnerBehavior=true&v=…
 * → Result.UserCards.Cards[] → per-card {last4} (Last4Digits, which matches a
 * txn row's shortCardNumber). Raw rows normalise downstream via the Data
 * Mapper — never in the shape.
 */

import type {
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';
import { isSome } from '../../../Types/Option.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';

/** Max registered API origin — the post-login SPA host. */
export const MAX_API = 'https://www.max.co.il/api/registered';

/** Card display number (last-4) — branded for Rule #15. */
type CardNumberDisplay = Brand<string, 'MaxCardNumberDisplay'>;

/** Discovered SPA build version — branded for Rule #15. */
type ClientVersion = Brand<string, 'MaxClientVersion'>;

/** URL carrying the optional `&v=` build param — branded for Rule #15. */
type VersionedUrl = Brand<string, 'MaxVersionedUrl'>;

/** Max card reference — `last4` matches a txn row's `shortCardNumber`. */
export interface IMaxCard {
  readonly last4: string;
}

interface IRawCard {
  readonly Last4Digits?: string;
}
interface IUserCards {
  readonly Cards?: readonly IRawCard[];
}
interface ICustomerResp {
  readonly Result?: { readonly UserCards?: IUserCards | null } | null;
}

/**
 * Read the SPA build-version stashed on the mediator session-context at
 * BIND-API-MEDIATOR; '' when the mediator slot or version is absent.
 * @param ctx - Action context.
 * @returns Client version string, or '' when unavailable.
 */
export function clientVersionOf(ctx: IActionContext): ClientVersion {
  if (!isSome(ctx.apiMediator)) return '' as ClientVersion;
  const session = ctx.apiMediator.value.getSessionContext();
  const version = session.clientVersion;
  return (typeof version === 'string' ? version : '') as ClientVersion;
}

/**
 * Append Max's `&v=<version>` build param to a URL that already carries a
 * query string; pass the URL through unchanged when no version is known.
 * @param url - URL carrying an existing `?…` query.
 * @param version - Discovered client version (or '').
 * @returns URL with the version param when present.
 */
export function withVersion(url: string, version: string): VersionedUrl {
  return (version ? `${url}&v=${version}` : url) as VersionedUrl;
}

/**
 * No-op variables builder — every Max step is GET (params ride the URL) or
 * skipFetch, so no request body is ever sent.
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
}

/**
 * Customer URL — getHomePageData (the card list), version-tagged.
 * @param ctx - Action context (carries the discovered client version).
 * @returns Literal Max getHomePageData URL.
 */
export function customerUrl(ctx: IActionContext): WKUrlOrLiteral {
  const base = `${MAX_API}/getHomePageData?disableDefaultSpinnerBehavior=true`;
  const version = clientVersionOf(ctx);
  const url = withVersion(base, version);
  return literalUrl(url);
}

/**
 * Map one raw card to a card reference (Last4Digits → last4).
 * @param c - Raw card entry from Result.UserCards.Cards.
 * @returns Card reference.
 */
function toCard(c: IRawCard): IMaxCard {
  return { last4: c.Last4Digits ?? '' };
}

/**
 * Flatten Result.UserCards.Cards[] into card refs.
 * @param args - Extract-args bundle (reads args.body only).
 * @returns Card list (empty when the container is absent).
 */
export function extractCards(args: IExtractAccountsArgs): readonly IMaxCard[] {
  const resp = args.body as unknown as ICustomerResp;
  const cards = resp.Result?.UserCards?.Cards ?? [];
  return cards.map(toCard);
}

/**
 * User-facing card number (last-4).
 * @param card - Max card.
 * @returns Display number.
 */
export function accountNumberOf(card: IMaxCard): CardNumberDisplay {
  return card.last4 as CardNumberDisplay;
}
