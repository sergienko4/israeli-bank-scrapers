/**
 * VisaCal per-card balance — the card's next ILS debit, read from CAL's
 * frames endpoint one card per request.
 *
 * `GetTotalFrameStatus` answers `result.calIssuedCards.accountLevelFrames[]`;
 * the frame whose `cardUniqueId` is the card's own carries `nextTotalDebit`,
 * the total of that card's charges on its next debit date. A card with no
 * frame (or a non-numeric figure) has nothing pending, so it reports 0 —
 * attribution is by card id only, never a household total.
 */

import type { ApiBody, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';
import { CAL_API, type IVisaCalCard } from './VisaCalShapeHelpers.js';

/** A card's next ILS debit — branded for Rule #15. */
export type VisaCalNextDebit = Brand<number, 'VisaCalNextDebit'>;

/** The figure for a card with nothing pending. */
const NO_NEXT_DEBIT = 0 as VisaCalNextDebit;

interface IRawFrame {
  readonly cardUniqueId?: string;
  readonly nextTotalDebit?: unknown;
}
interface IFramesResp {
  readonly result?: {
    readonly calIssuedCards?: { readonly accountLevelFrames?: readonly IRawFrame[] };
  };
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
 * The card's next ILS debit, or 0 when no frame names the card.
 * @param body - Frames response.
 * @param card - The account being assembled.
 * @returns The card's `nextTotalDebit`, or 0.
 */
export function nextTotalDebitOf(body: ApiBody, card: IVisaCalCard): VisaCalNextDebit {
  const resp = body as unknown as IFramesResp;
  const frames = resp.result?.calIssuedCards?.accountLevelFrames ?? [];
  const own = frames.find(frame => frame.cardUniqueId === card.cardUniqueId);
  const debit = own?.nextTotalDebit;
  if (typeof debit !== 'number' || !Number.isFinite(debit)) return NO_NEXT_DEBIT;
  return debit as VisaCalNextDebit;
}
