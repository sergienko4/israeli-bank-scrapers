/**
 * Ring scrape shape — the card list. `CardsList_102Digital` returns one
 * `Table1` row per card: `cardNumber` is the card's last four digits (the
 * account number, as on the former web path) and `paymentDate` is the debit
 * day of the month, which the balance step needs to pick the next statement.
 * A row whose `cardNumber` is not four digits names no card GatewayV2 can be
 * asked about, so the list no longer matches the contract: no card is
 * returned and `ZeroAccountsGuard` fails the scrape loudly, rather than
 * silently omit one card's money.
 */

import type { IRingConstants } from '../../../Registry/Config/PipelineBankConfigRingConstants.js';
import { RING_WALLET_ID } from '../../../Registry/Config/PipelineBankConfigRingConstants.js';
import { type LiteralUrl, literalUrl } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';
import type { IExtractAccountsArgs, VarsMap } from '../IApiDirectScrapeShape.js';

const CARDS_SERVICE = 'CardsList_102Digital';
const CARD_4_WIDTH = 4;
const CARD_4_DIGITS = /^\d{4}$/;
const FIRST_DAY = 1;
const LAST_DAY = 31;
const NO_CARDS: readonly IRingCard[] = [];

type CardNumberDisplay = Brand<string, 'RingCardNumberDisplay'>;

/** One ring card, as the balance and transaction steps need it. */
export interface IRingCard {
  readonly card4Number: string;
  /** Debit day of the month, or false when the row carries none. */
  readonly paymentDay: number | false;
  readonly companyCode: number;
}

interface IRawCard {
  readonly cardNumber?: string | number | null;
  readonly paymentDate?: string | number | null;
}
interface ICardsResp {
  readonly CardsList_102DigitalBean?: { readonly Table1?: readonly IRawCard[] | null } | null;
}

/** Card-extract function bound to one ring issuer. */
export type RingCardsExtract = (args: IExtractAccountsArgs) => readonly IRingCard[];

/**
 * The CardsList request body.
 * @returns Wallet id + service name.
 */
export function cardsVars(): VarsMap {
  return { walletId: RING_WALLET_ID, reqName: CARDS_SERVICE };
}

/**
 * The CardsList endpoint for one ring issuer.
 * @param ring - The issuer's ring constants.
 * @returns Literal service URL.
 */
export function cardsUrl(ring: IRingConstants): LiteralUrl {
  const query = `serviceName=${CARDS_SERVICE}&applicationId=${ring.applicationId}`;
  return literalUrl(`${ring.base}/service?${query}`);
}

/**
 * Parse the debit day ("02", "10", 10); anything outside 1–31 is unknown.
 * @param raw - Raw `paymentDate` value.
 * @returns Day of the month, or false.
 */
function paymentDayOf(raw: IRawCard['paymentDate']): number | false {
  const day = Number(raw ?? Number.NaN);
  const isDay = Number.isInteger(day) && day >= FIRST_DAY && day <= LAST_DAY;
  return isDay ? day : false;
}

/**
 * Read a row's last four digits; a numeric value gets its leading zeros back.
 * @param raw - Raw `cardNumber` value.
 * @returns Four digits, or false when the row names no card.
 */
function card4Of(raw: IRawCard['cardNumber']): string | false {
  const isNumeric = typeof raw === 'number';
  const text = isNumeric ? String(raw).padStart(CARD_4_WIDTH, '0') : (raw ?? '');
  return CARD_4_DIGITS.test(text) ? text : false;
}

/**
 * Map one raw row to a card.
 * @param raw - Raw Table1 row.
 * @param companyCode - The issuer's numeric company code.
 * @returns Ring card, or false for a row with no four-digit card number.
 */
function toCard(raw: IRawCard, companyCode: number): IRingCard | false {
  const card4Number = card4Of(raw.cardNumber);
  if (card4Number === false) return false;
  const paymentDay = paymentDayOf(raw.paymentDate);
  return { card4Number, paymentDay, companyCode };
}

/**
 * Whether a row mapped to a card.
 * @param card - Mapped row.
 * @returns True for a card.
 */
function isCard(card: IRingCard | false): card is IRingCard {
  return card !== false;
}

/**
 * Trust the list only when every row names a card.
 * @param mapped - Every row, mapped.
 * @returns The cards, or none when any row named no card.
 */
function trustedCards(mapped: readonly (IRingCard | false)[]): readonly IRingCard[] {
  return mapped.every(isCard) ? mapped : NO_CARDS;
}

/**
 * Build the card extractor for one ring issuer.
 * @param ring - The issuer's ring constants.
 * @returns Extractor over a CardsList response (no rows → no cards).
 */
export function buildExtractCards(ring: IRingConstants): RingCardsExtract {
  const companyCode = Number(ring.companyCode);
  return (args: IExtractAccountsArgs): readonly IRingCard[] => {
    const resp = args.body as ICardsResp;
    const rows = resp.CardsList_102DigitalBean?.Table1 ?? [];
    const mapped = rows.map((raw): IRingCard | false => toCard(raw, companyCode));
    return trustedCards(mapped);
  };
}

/**
 * The account number for a ring card.
 * @param card - Ring card.
 * @returns The card's last four digits.
 */
export function accountNumberOf(card: IRingCard): CardNumberDisplay {
  return card.card4Number as CardNumberDisplay;
}
