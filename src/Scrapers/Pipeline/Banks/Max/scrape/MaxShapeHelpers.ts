/**
 * Max scrape shape — card-list extractor, the getHomePageData customer GET
 * URL, and the per-call headers both data steps send.
 * balanceKind=card-cycle: the per-card ILS cycle debit rides the same
 * getHomePageData card object, so `balance.skipFetch` stays on and the shape
 * reads the figure off the account (see MaxShapeBalance.ts). The session is
 * the cookie the API-DIRECT-CALL login set, kept by the node transport.
 * Transactions helpers live in MaxShapeTxns.ts; row filtering in
 * MaxShapeExtract.ts.
 *
 * Grounded in the Max trace: customer =
 * GET /api/registered/getHomePageData?disableDefaultSpinnerBehavior=true
 * → Result.UserCards.Cards[] → per-card {last4} (Last4Digits, which matches a
 * txn row's shortCardNumber). Raw rows normalise downstream via the Data
 * Mapper — never in the shape.
 */

import { randomUUID } from 'node:crypto';

import type {
  HeaderMap,
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  MAX_ORIGIN,
  MAX_STATIC_HEADERS,
} from '../../../Registry/Config/PipelineBankConfigMaxConstants.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';
import { isSome } from '../../../Types/Option.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { ilsCycleDebit, type IMaxRawCycle } from './MaxShapeBalance.js';

/** Max registered data API — on the same origin as login. */
export const MAX_API = `${MAX_ORIGIN}/api/registered`;

/** Card display number (last-4) — branded for Rule #15. */
type CardNumberDisplay = Brand<string, 'MaxCardNumberDisplay'>;

/** Max card reference — `last4` matches a txn row's `shortCardNumber`. */
export interface IMaxCard {
  readonly last4: string;
  /**
   * Outstanding ILS billing-cycle debit, carried from the same card object
   * the list was built from so the balance step needs no second call.
   */
  readonly cycleDebit: number;
}

interface IRawCard extends IMaxRawCycle {
  readonly Last4Digits?: string;
}
interface IUserCards {
  readonly Cards?: readonly IRawCard[];
}
interface ICustomerResp {
  readonly Result?: { readonly UserCards?: IUserCards | null } | null;
}

/**
 * The run's session id, or an empty value before login has stored one.
 * It is the flow id the mediator minted for the login, read from the
 * carry's post-login snapshot (the session context).
 * @param ctx - Action context carrying the API mediator.
 * @returns The session id, or an empty string.
 */
function sidOf(ctx: IActionContext): string {
  if (!isSome(ctx.apiMediator)) return '';
  const session = ctx.apiMediator.value.getSessionContext();
  const sid = session.flowId;
  return typeof sid === 'string' ? sid : '';
}

/**
 * Headers for one data call: the static set the login steps send, the run's
 * session id and a fresh correlation id. Login's static and step headers do
 * not reach the scrape phase, so the shape rebuilds them.
 * @param ctx - Action context.
 * @returns Header map.
 */
export function maxHeaders(ctx: IActionContext): HeaderMap {
  const sid = sidOf(ctx);
  return { ...MAX_STATIC_HEADERS, sid, cid: randomUUID() };
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
 * Customer URL — getHomePageData (the card list).
 * @returns Literal Max getHomePageData URL.
 */
export function customerUrl(): WKUrlOrLiteral {
  return literalUrl(`${MAX_API}/getHomePageData?disableDefaultSpinnerBehavior=true`);
}

/**
 * Map one raw card to a card reference (Last4Digits → last4), carrying the
 * card's own ILS cycle debit so the balance step reads it without a fetch.
 * @param c - Raw card entry from Result.UserCards.Cards.
 * @returns Card reference.
 */
function toCard(c: IRawCard): IMaxCard {
  return { last4: c.Last4Digits ?? '', cycleDebit: ilsCycleDebit(c) };
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
