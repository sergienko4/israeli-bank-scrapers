/**
 * Card-issuer monthly cursor policy — the shared calendar walk behind the
 * Amex, Isracard, Max and VisaCal transaction shapes. Those four issuers
 * page a scrape backwards one billing month at a time, and each previously
 * kept a private copy of the same arithmetic; this module is the single
 * place that walk is decided.
 *
 * The walk is the *fallback* path. When
 * {@link detectBillingCycleCatalog} resolves a real billing-cycle catalog
 * (Isracard / Max / VisaCal), SCRAPE uses that instead and these helpers
 * are not consulted. They cover the case where no catalog is available.
 *
 * The window's upper bound comes from `scrapeWindowEnd(ctx)`, never from
 * the clock: the coverage backfill re-asks for an older slice by handing
 * the shape a narrowed `windowEnd`, which only works while that helper is
 * the single place the bound is decided.
 *
 * Issuer-neutral: a bank supplies its own open-cycle floor at the call
 * site, so adding a fifth issuer needs no change here.
 */

import type moment from 'moment';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { bankMomentOfInstant } from '../../../Mediator/Scrape/BankCalendar.js';
import type { IBankMonth } from '../../../Mediator/Scrape/BankMonth.js';
import { bankMonthOfInstant, shiftBankInstant } from '../../../Mediator/Scrape/BankMonth.js';
import {
  boundedMonthCount,
  MAX_MONTH_REQUESTS,
} from '../../../Mediator/Scrape/MonthRangeBudget.js';
import { scrapeWindowEnd } from '../../../Mediator/Scrape/ScrapeWindowEnd.js';
import type { Brand } from '../../../Types/Brand.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import { getFutureMonths } from '../../../Types/ScraperDefaults.js';

/**
 * Month-offset pagination cursor — `false` on the first call, otherwise the
 * 0-based offset of the billing month being fetched. Unbranded because it
 * crosses the shape boundary as a raw pagination value.
 */
export type TMonthCursor = number | false;

/** 0-based offset from the window start month — branded for Rule #15. */
export type TMonthOffset = Brand<number, 'CardMonthOffset'>;

/** Composite `01/MM/YYYY` billing month — branded for Rule #15. */
export type TBillingMonth = Brand<string, 'CardBillingMonth'>;

/**
 * First billing month of the scrape window (from ScraperOptions.startDate).
 *
 * <p>Read in the bank's zone, not the host's. The caller supplies an instant;
 * the provider expects the bank-calendar day it falls on. Formatting it
 * ambiently names the previous day west of Israel (harmless over-fetch) and
 * the *next* day east of it — which never asks for the caller's first day and
 * leaves a gap no backfill can close, because the gap is at the far end.
 * For an issuer that is a whole billing cycle, not a day.
 *
 * @param ctx - Action context.
 * @returns Start-of-month moment for the window start.
 */
export function startMonth(ctx: IActionContext): moment.Moment {
  return bankMomentOfInstant(ctx.options.startDate).startOf('month');
}

/**
 * Resolve the 0-based month offset for this round (0 on the first call).
 *
 * @param cursor - Incoming cursor (false on first call).
 * @returns Month offset.
 */
export function offsetOf(cursor: TMonthCursor): TMonthOffset {
  const offset = cursor === false ? 0 : cursor;
  return offset as TMonthOffset;
}

/**
 * Target billing month for a given offset.
 *
 * @param ctx - Action context.
 * @param offset - 0-based month offset.
 * @returns Moment for the target month.
 */
export function monthAt(ctx: IActionContext, offset: number): moment.Moment {
  return startMonth(ctx).add(offset, 'months');
}

/**
 * Composite first-of-month billing month `01/MM/YYYY`, the form the Amex
 * and Isracard request bodies carry.
 *
 * @param ctx - Action context.
 * @param offset - 0-based month offset.
 * @returns billingMonth string.
 */
export function billingMonthAt(ctx: IActionContext, offset: number): TBillingMonth {
  const mm = monthAt(ctx, offset).format('MM/YYYY');
  return `01/${mm}` as TBillingMonth;
}

/**
 * Future-month count actually applied to the window, raised to the issuer's
 * open-cycle floor when it declares one.
 *
 * <p>An issuer that declares no floor keeps `getFutureMonths` verbatim. That
 * is deliberate rather than a defaulted `0`: `getFutureMonths` does not
 * clamp, and `futureMonthsToScrape` is an unconstrained public option, so a
 * negative value reaches here. Flooring at 0 would widen the window for the
 * unfloored issuers instead of preserving today's behaviour.
 *
 * @param ctx - Action context.
 * @param floor - Issuer open-cycle floor in months; omitted when none.
 * @returns Effective future-month count.
 */
function effectiveFutureMonths(ctx: IActionContext, floor?: number): number {
  const requested = getFutureMonths(ctx.options);
  return Math.max(requested, floor ?? requested);
}

/**
 * Last month in the issuer's effective request window.
 * @param ctx - Action context carrying the upper bound.
 * @param floor - Issuer open-cycle floor in months.
 * @returns Validated bank month, or false for an unreadable bound.
 */
function requestEndMonth(ctx: IActionContext, floor?: number): IBankMonth | false {
  const future = effectiveFutureMonths(ctx, floor);
  const windowEnd = scrapeWindowEnd(ctx);
  const end = shiftBankInstant(windowEnd, future);
  if (end === false) return false;
  return bankMonthOfInstant(end);
}

/**
 * Fail closed when a complete issuer walk cannot fit the shared request budget.
 * An unreadable caller start remains the coverage audit's responsibility.
 * @param ctx - Action context carrying the requested window.
 * @param floor - Issuer open-cycle floor in months.
 * @returns Successful validation or a typed plan rejection.
 */
export function validateCardIssuerPlan(ctx: IActionContext, floor?: number): Procedure<void> {
  const first = bankMonthOfInstant(ctx.options.startDate);
  if (first === false) return succeed(undefined);
  const last = requestEndMonth(ctx, floor);
  const count = last === false ? false : boundedMonthCount(first, last);
  if (count !== false && count > 0) return succeed(undefined);
  const limit = String(MAX_MONTH_REQUESTS);
  const message = `Card issuer: invalid or oversized month plan (limit ${limit})`;
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Highest in-window month offset — months from the start month to the
 * scrape window end, extended by the effective future-month count.
 *
 * <p>VisaCal passes a floor of 1: CAL indexes a billing month by its debit
 * date, so a purchase made today belongs to next month's cycle. Without the
 * floor, `futureMonthsToScrape: 0` would silently drop up to a month of
 * already-made purchases.
 *
 * @param ctx - Action context.
 * @param floor - Issuer open-cycle floor in months; omitted when none.
 * @returns Last 0-based month offset.
 */
export function lastOffset(ctx: IActionContext, floor?: number): TMonthOffset {
  const future = effectiveFutureMonths(ctx, floor);
  const windowEnd = scrapeWindowEnd(ctx);
  // Both operands in the bank's zone. Anchoring only one of them would make
  // `diff` compare month starts across zones and floor away the terminal
  // billing month — a whole cycle of transactions, silently.
  const end = bankMomentOfInstant(windowEnd).add(future, 'months').startOf('month');
  const start = startMonth(ctx);
  return end.diff(start, 'months') as TMonthOffset;
}

/**
 * Advance the cursor, or terminate the walk once the ceiling is reached.
 *
 * <p>Taking the ceiling as a plain argument is what keeps this issuer-
 * neutral — the caller has already applied its own floor via
 * {@link lastOffset}, so this function never needs to know which issuer
 * asked.
 *
 * @param offset - Offset just fetched.
 * @param ceiling - Highest in-window offset, from {@link lastOffset}.
 * @returns Next cursor, or false to stop.
 */
export function nextCursorOf(offset: number, ceiling: number): TMonthCursor {
  return offset < ceiling ? offset + 1 : false;
}
