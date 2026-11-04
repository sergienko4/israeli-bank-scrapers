/**
 * Ring scrape shape — balance. A card's balance is its next debit: the
 * GatewayV2 statement total (`totalForStatement.totalIlsBillingDate`) for
 * the month the card is next charged. On or before the card's debit day that
 * is this month, after it the next. A month with no charges carries no
 * vouchers node and is a real 0; vouchers without a finite total, or a card
 * with no debit day, are unknown. A reply the bank did not confirm never
 * reaches here — the shape's body check fails it first.
 */

import type moment from 'moment';

import { bankMomentOfInstant } from '../../../Mediator/Scrape/BankCalendar.js';
import type { Brand } from '../../../Types/Brand.js';
import type { TBillingMonth } from '../CardIssuer/CardIssuerShapeTxns.js';
import type { ApiBody, VarsMap } from '../IApiDirectScrapeShape.js';
import type { IRingCard } from './RingShapeCards.js';
import { gatewayBody } from './RingShapeTxns.js';

export type RingNextDebit = Brand<number, 'RingNextDebit'>;
type IsBalanceAbsent = Brand<boolean, 'RingIsBalanceAbsent'>;

const NO_NEXT_DEBIT = 0 as RingNextDebit;

interface IStatementTotal {
  readonly totalIlsBillingDate?: unknown;
}
interface IVouchers {
  readonly totalForStatement?: IStatementTotal | null;
}
interface IBalanceResp {
  readonly data?: {
    readonly israelAbroadVouchers?: { readonly vouchers?: IVouchers | null } | null;
  } | null;
}

/**
 * The billing month of the card's next debit.
 * @param today - Today in the bank's calendar.
 * @param paymentDay - The card's debit day, or false when unknown.
 * @returns `01/MM/YYYY` — this month on or before the debit day, else next.
 */
export function nextDebitMonth(today: moment.Moment, paymentDay: number | false): TBillingMonth {
  const isPast = paymentDay !== false && today.date() > paymentDay;
  const month = today
    .clone()
    .startOf('month')
    .add(isPast ? 1 : 0, 'months');
  return `01/${month.format('MM/YYYY')}` as TBillingMonth;
}

/**
 * The balance body: the card's next debit month.
 * @param card - Ring card.
 * @returns GatewayV2 body.
 */
export function balanceVars(card: IRingCard): VarsMap {
  const today = bankMomentOfInstant(new Date());
  const month = nextDebitMonth(today, card.paymentDay);
  return gatewayBody(card, month);
}

/**
 * The month's vouchers node.
 * @param body - GatewayV2 response body.
 * @returns The vouchers, or false for a month with none.
 */
function vouchersOf(body: ApiBody): IVouchers | false {
  const resp = body as IBalanceResp;
  return resp.data?.israelAbroadVouchers?.vouchers ?? false;
}

/**
 * Whether a value is a usable amount.
 * @param value - Candidate.
 * @returns True for a finite number.
 */
function isFigure(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The statement total of a month that has vouchers.
 * @param vouchers - The month's vouchers.
 * @returns The ILS total, or false when it is missing or not a finite number.
 */
function statementFigureOf(vouchers: IVouchers): number | false {
  const figure = vouchers.totalForStatement?.totalIlsBillingDate;
  return isFigure(figure) ? figure : false;
}

/**
 * Whether the reply cannot state the card's next debit.
 * @param body - GatewayV2 response body.
 * @param card - Ring card.
 * @returns True when unknown (publish no balance), false when readable.
 */
export function balanceIsAbsent(body: ApiBody, card: IRingCard): IsBalanceAbsent {
  if (card.paymentDay === false) return true as IsBalanceAbsent;
  const vouchers = vouchersOf(body);
  const isMalformed = vouchers !== false && statementFigureOf(vouchers) === false;
  return isMalformed as IsBalanceAbsent;
}

/**
 * The card's next debit amount in ILS.
 * @param body - GatewayV2 response body.
 * @returns Statement total, or 0 for a month with no vouchers.
 */
export function nextDebitOf(body: ApiBody): RingNextDebit {
  const vouchers = vouchersOf(body);
  if (vouchers === false) return NO_NEXT_DEBIT;
  const figure = statementFigureOf(vouchers);
  return (figure === false ? NO_NEXT_DEBIT : figure) as RingNextDebit;
}
