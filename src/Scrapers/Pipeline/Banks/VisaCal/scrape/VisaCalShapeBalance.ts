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
 * not confirm, or whose frame structure is malformed, carries no figure at
 * all. A confirmed matching frame with a non-numeric figure follows CAL's
 * no-data contract and reports 0.
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
type FrameList = readonly IRawFrame[] | false;

/**
 * Whether a value is a non-array object.
 * @param value - Candidate response value.
 * @returns True for a record.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a frame is safe to inspect.
 * @param value - Candidate frame.
 * @returns True for a frame with a string card id.
 */
function isFrame(value: unknown): value is IRawFrame {
  return isRecord(value) && typeof value.cardUniqueId === 'string';
}

/**
 * Read one issuer's frame list.
 * @param group - Candidate issuer group.
 * @returns Its frames, an empty list when absent, or false when malformed.
 */
function framesOf(group: unknown): FrameList {
  if (group === undefined || group === null) return [];
  if (!isRecord(group)) return false;
  const frames = group.accountLevelFrames;
  if (frames === undefined) return [];
  if (!Array.isArray(frames) || !frames.every(isFrame)) return false;
  return frames;
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
 * Balance URL — the static frames endpoint on the mobile gateway.
 * @returns Literal CAL frames URL.
 */
export function balanceUrl(): WKUrlOrLiteral {
  return literalUrl(`${CAL_API}/Frames/api/Frames/GetTotalFrameStatus`);
}

/**
 * The frames that name this card, from both issuer groups.
 * @param resp - Frames response.
 * @param card - The account being assembled.
 * @returns The card's own frames, or false when either frame list is malformed.
 */
function ownFramesOf(resp: unknown, card: IVisaCalCard): FrameList {
  if (!isRecord(resp) || !isRecord(resp.result)) return false;
  const cal = framesOf(resp.result.calIssuedCards);
  const bank = framesOf(resp.result.bankIssuedCards);
  if (cal === false || bank === false) return false;
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
function isConfirmed(resp: unknown): boolean {
  if (!isRecord(resp)) return false;
  if (resp.statusCode !== CAL_OK) return false;
  return isRecord(resp.result);
}

/**
 * Declare a frames reply that carries NO figure for the card. Consulted by
 * the driver before {@link nextTotalDebitOf}.
 * @param body - Frames response.
 * @param card - The account being assembled.
 * @returns True when CAL did not confirm the reply or its frame structure is
 *   malformed.
 */
export function balanceIsAbsent(body: ApiBody, card: IVisaCalCard): IsBalanceAbsent {
  const resp: unknown = body;
  if (!isConfirmed(resp)) return true as IsBalanceAbsent;
  return (ownFramesOf(resp, card) === false) as IsBalanceAbsent;
}

/**
 * The card's next ILS debit, or 0 when no frame names the card or none of
 * its frames carries a finite figure.
 * @param body - Frames response.
 * @param card - The account being assembled.
 * @returns The card's `nextTotalDebit`, or 0.
 */
export function nextTotalDebitOf(body: ApiBody, card: IVisaCalCard): VisaCalNextDebit {
  const own = ownFramesOf(body, card);
  if (own === false) return NO_NEXT_DEBIT;
  const figure = own.map((frame): unknown => frame.nextTotalDebit).find(isFigure);
  return (figure ?? NO_NEXT_DEBIT) as VisaCalNextDebit;
}
