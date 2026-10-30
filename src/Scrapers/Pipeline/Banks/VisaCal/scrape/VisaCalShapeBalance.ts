/**
 * VisaCal per-card balance — the card's next ILS debit, read from CAL's
 * frames endpoint one card per request.
 *
 * `GetTotalFrameStatus` answers `result.calIssuedCards` and
 * `result.bankIssuedCards`, each carrying `accountLevelFrames[]` in one
 * shared schema; the frame whose `cardUniqueId` is the card's own carries
 * `nextTotalDebit`, the total of that card's charges on its next debit date.
 * Attribution is by card id only, never a household total.
 *
 * A reply CAL confirmed (`statusCode` 1 with a `result`) that names no frame
 * for the card has nothing pending, so the card reports 0. A reply CAL did
 * not confirm, or a frame whose figure is not a finite number, carries no
 * figure at all: {@link balanceIsAbsent} says so, and the driver publishes
 * no balance and marks the scrape degraded rather than invent a 0.
 */

import type { ApiBody, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';
import { CAL_API, type IVisaCalCard } from './VisaCalShapeHelpers.js';

/** A card's next ILS debit — branded for Rule #15. */
export type VisaCalNextDebit = Brand<number, 'VisaCalNextDebit'>;
/** Whether a card's next-debit figure is missing — branded for Rule #15. */
type IsBalanceAbsent = Brand<boolean, 'VisaCalIsBalanceAbsent'>;

/** The figure for a card with nothing pending. */
const NO_NEXT_DEBIT = 0 as VisaCalNextDebit;
/** CAL's envelope status for an answered request. */
const CAL_OK = 1;

interface IRawFrame {
  readonly cardUniqueId?: string;
  readonly nextTotalDebit?: unknown;
}
interface IIssuerGroup {
  readonly accountLevelFrames?: readonly IRawFrame[];
}
interface IFramesResp {
  readonly statusCode?: number;
  readonly result?: {
    readonly calIssuedCards?: IIssuerGroup | null;
    readonly bankIssuedCards?: IIssuerGroup | null;
  } | null;
}

/**
 * Frames POST body — one card per request.
 * @param card - The card whose frame is asked for.
 * @returns Frames request body.
 */
export function balanceVars(card: IVisaCalCard): VarsMap {
  return { cardsForFrameData: [{ cardUniqueId: card.cardUniqueId }] };
}

/**
 * Balance URL — the static frames endpoint on the web gateway.
 * @returns Literal CAL frames URL.
 */
export function balanceUrl(): WKUrlOrLiteral {
  return literalUrl(`${CAL_API}/Frames/api/Frames/GetTotalFrameStatus`);
}

/**
 * The frames that name this card, from both issuer groups.
 * @param resp - Frames response.
 * @param card - The account being assembled.
 * @returns The card's own frames — usually one, empty when none names it.
 */
function ownFramesOf(resp: IFramesResp, card: IVisaCalCard): readonly IRawFrame[] {
  const cal = resp.result?.calIssuedCards?.accountLevelFrames ?? [];
  const bank = resp.result?.bankIssuedCards?.accountLevelFrames ?? [];
  const frames = [...cal, ...bank];
  return frames.filter((frame): boolean => frame.cardUniqueId === card.cardUniqueId);
}

/**
 * Whether a frame field holds a usable figure.
 * @param value - The raw `nextTotalDebit`.
 * @returns True for a finite number.
 */
function isFigure(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether CAL answered the request: status OK and a result present.
 * @param resp - Frames response.
 * @returns True when the reply is confirmed.
 */
function isConfirmed(resp: IFramesResp): boolean {
  if (resp.statusCode !== CAL_OK) return false;
  return typeof resp.result === 'object' && resp.result !== null;
}

/**
 * Declare a frames reply that carries NO figure for the card. Consulted by
 * the driver before {@link nextTotalDebitOf}.
 * @param body - Frames response.
 * @param card - The account being assembled.
 * @returns True when CAL did not confirm the reply, or the card's frame
 *   carries no finite `nextTotalDebit`.
 */
export function balanceIsAbsent(body: ApiBody, card: IVisaCalCard): IsBalanceAbsent {
  const resp = body as unknown as IFramesResp;
  if (!isConfirmed(resp)) return true as IsBalanceAbsent;
  const own = ownFramesOf(resp, card);
  const isMalformed = own.some((frame): boolean => !isFigure(frame.nextTotalDebit));
  return isMalformed as IsBalanceAbsent;
}

/**
 * The card's next ILS debit, or 0 when no frame names the card.
 * @param body - Frames response.
 * @param card - The account being assembled.
 * @returns The card's `nextTotalDebit`, or 0.
 */
export function nextTotalDebitOf(body: ApiBody, card: IVisaCalCard): VisaCalNextDebit {
  const resp = body as unknown as IFramesResp;
  const own = ownFramesOf(resp, card);
  const figure = own.map((frame): unknown => frame.nextTotalDebit).find(isFigure);
  return (figure ?? NO_NEXT_DEBIT) as VisaCalNextDebit;
}
