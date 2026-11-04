/**
 * Ring scrape shape — balance. The next debit is the GatewayV2 statement
 * total for the card's next debit month: this month on or before the debit
 * day, else the next. A month with no vouchers is a real 0; vouchers without
 * a readable total, or an unknown debit day, are unknown. Whether the bank
 * confirmed the reply is the envelope check's job (RingShape.test). Bodies
 * are synthetic — zero PII.
 */

import { jest } from '@jest/globals';
import moment from 'moment-timezone';

import type { ApiBody } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  balanceIsAbsent,
  balanceVars,
  nextDebitMonth,
  nextDebitOf,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/Ring/RingShapeBalance.js';
import type { IRingCard } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/Ring/RingShapeCards.js';

const ZONE = 'Asia/Jerusalem';
const CARD: IRingCard = { card4Number: '1234', paymentDay: 10, companyCode: 11 };
const NO_DAY: IRingCard = { ...CARD, paymentDay: false };

/**
 * A bank-calendar day.
 * @param day - `YYYY-MM-DD`.
 * @returns Moment at noon in the bank's zone.
 */
function bankDay(day: string): moment.Moment {
  return moment.tz(`${day} 12:00`, ZONE);
}

/**
 * A GatewayV2 reply whose month has vouchers.
 * @param vouchers - The vouchers node; null when the bank sends it empty.
 * @returns Response body.
 */
function withVouchers(vouchers: unknown): ApiBody {
  return { isSuccess: true, errorCode: '0', data: { israelAbroadVouchers: { vouchers } } };
}

/**
 * A GatewayV2 reply carrying a statement total.
 * @param total - `totalIlsBillingDate` value.
 * @returns Response body.
 */
function withTotal(total: unknown): ApiBody {
  const totalForStatement = { totalIlsBillingDate: total };
  return withVouchers({ israelAbroadVouchersList: [], totalForStatement });
}

const NO_VOUCHERS: ApiBody = { isSuccess: true, errorCode: '0', data: { approvals: null } };
const NO_TOTAL = withVouchers({ israelAbroadVouchersList: [] });
const NULL_TOTAL = withVouchers({ israelAbroadVouchersList: [], totalForStatement: null });

describe('ring next debit month', () => {
  it.each([
    ['2026-10-05', 10, '01/10/2026'],
    ['2026-10-10', 10, '01/10/2026'],
    ['2026-10-29', 10, '01/11/2026'],
    ['2026-12-20', 2, '01/01/2027'],
    ['2026-10-29', false, '01/10/2026'],
  ] as const)('on %s with debit day %p is %s', (day, paymentDay, expected) => {
    const today = bankDay(day);
    const month = nextDebitMonth(today, paymentDay);
    expect(month).toBe(expected);
  });

  describe('balance request (frozen clock)', () => {
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-12-20T10:00:00Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it('asks GatewayV2 for the card next debit month across the year end', () => {
      const vars = balanceVars({ ...CARD, paymentDay: 2 });
      expect(vars.serviceUrl).toBe('11/v3-transactions/v1.1.0/GetTransactionsList');
      expect(vars.Data).toMatchObject({ card4Number: '1234', billingMonth: '01/01/2027' });
    });
  });
});

describe('ring next debit amount', () => {
  it('reads the statement ILS total', () => {
    const body = withTotal(812.4);
    const isAbsent = balanceIsAbsent(body, CARD);
    const nextDebit = nextDebitOf(body);
    expect(isAbsent).toBe(false);
    expect(nextDebit).toBe(812.4);
  });

  it.each([
    ['no vouchers node', NO_VOUCHERS],
    ['a null vouchers node', withVouchers(null)],
  ] as const)('is a real 0 for a month with %s', (_label, body) => {
    const isAbsent = balanceIsAbsent(body, CARD);
    const nextDebit = nextDebitOf(body);
    expect(isAbsent).toBe(false);
    expect(nextDebit).toBe(0);
  });

  it.each([
    ['vouchers with no statement total', NO_TOTAL, CARD],
    ['vouchers with a null statement total', NULL_TOTAL, CARD],
    ['a non-numeric total', withTotal('812.4'), CARD],
    ['a null total', withTotal(null), CARD],
    ['a card with no debit day', withTotal(812.4), NO_DAY],
  ] as const)('is unknown for %s', (_label, body, card) => {
    const isAbsent = balanceIsAbsent(body, card);
    expect(isAbsent).toBe(true);
  });
});
