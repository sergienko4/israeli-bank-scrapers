/**
 * VisaCal hard-model scrape shape — unit coverage for the card, balance,
 * and per-card/per-month transactions extractors + the CAL POST bodies,
 * URLs, and month-offset cursor.
 *
 * Bodies are synthetic (structural only, fake values) so the test is
 * self-contained and carries zero PII. Field paths mirror the captured
 * VisaCal trace + upstream CAL contract (result.cards,
 * result.bankAccounts[].debitDates[].transactions +
 * result.bankAccounts[].immidiateDebits.debitDays[].transactions).
 */

import { jest } from '@jest/globals';

import { VISACAL_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/VisaCal/scrape/VisaCalShape.js';
import {
  accountNumberOf,
  customerUrl,
  customerVars,
  extractCards,
  type IVisaCalCard,
} from '../../../../../Scrapers/Pipeline/Banks/VisaCal/scrape/VisaCalShapeHelpers.js';
import {
  txnsExtractPage,
  txnsUrl,
  txnsVars,
} from '../../../../../Scrapers/Pipeline/Banks/VisaCal/scrape/VisaCalShapeTxns.js';
import type { ApiRecord } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { autoMapTransaction } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';
import type {
  ApiBody,
  IExtractAccountsArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { ITransaction } from '../../../../../Transactions.js';

const CARD: IVisaCalCard = { cardUniqueId: 'CARD-1', displayNumber: '1234' };

/**
 * Month offset of the still-open billing cycle relative to the current
 * calendar month. CAL indexes a cycle by its debit month, so purchases
 * made today sit in next month's cycle.
 */
const OPEN_CYCLE_OFFSET = 1;

/**
 * Clock pinned mid-month so the cursor tests cannot straddle a calendar
 * month boundary between building the context and the production code
 * reading `moment()`.
 */
const NOW = new Date('2026-07-15T12:00:00.000Z');

/**
 * Wrap a raw response body in the extractAccounts args bundle.
 * @param body - Synthetic response body.
 * @returns Extract-accounts args bundle.
 */
function accountsArgs(body: ApiBody): IExtractAccountsArgs {
  return { body, sessionContext: {} };
}

/**
 * Minimal action context carrying startDate + optional futureMonths.
 * @param startDate - Window start.
 * @param futureMonthsToScrape - Future months (0 pins lastOffset for
 *   deterministic cursor-termination tests).
 * @returns Action context.
 */
function ctxWith(startDate: Date, futureMonthsToScrape?: number): IActionContext {
  return { options: { startDate, futureMonthsToScrape } } as unknown as IActionContext;
}

describe('VisaCalShape helpers', () => {
  it('extractCards maps cardUniqueId (query id) + last4Digits (display)', () => {
    const body = { result: { cards: [{ cardUniqueId: 'CARD-1', last4Digits: '1234' }] } };
    const args = accountsArgs(body);
    const accounts = extractCards(args);
    expect(accounts).toEqual([{ cardUniqueId: 'CARD-1', displayNumber: '1234' }]);
  });

  it('extractCards falls back to cardUniqueId when last4Digits is absent', () => {
    const body = { result: { cards: [{ cardUniqueId: 'X-9' }] } };
    const args = accountsArgs(body);
    const accounts = extractCards(args);
    expect(accounts[0]).toEqual({ cardUniqueId: 'X-9', displayNumber: 'X-9' });
  });

  it('extractCards returns empty list when the container is missing', () => {
    const args = accountsArgs({});
    const accounts = extractCards(args);
    expect(accounts).toEqual([]);
  });

  it('accountNumberOf returns the display number', () => {
    const number = accountNumberOf(CARD);
    expect(number).toBe('1234');
  });

  it('balance extract is a deterministic 0 — bigNumbers is keyed by bank account, not card', () => {
    const balance = VISACAL_SHAPE.balance.extract({}, CARD);
    expect(balance).toBe(0);
  });

  it('customerVars opens the account/init envelope with an empty tokenGuid', () => {
    const vars = customerVars();
    expect(vars).toEqual({ tokenGuid: '' });
  });

  it('customerUrl is the static CAL account/init endpoint', () => {
    const url = customerUrl();
    expect(url).toBe('https://api.cal-online.co.il/Authentication/api/account/init');
  });
});

describe('VisaCalShape transactions', () => {
  it('txnsUrl targets the static getCardTransactionsDetails endpoint', () => {
    const url = txnsUrl();
    expect(url).toBe(
      'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails',
    );
  });

  it('txnsVars builds string month/year for the window-start month (cursor 0)', () => {
    const ctx = ctxWith(new Date(2024, 0, 15));
    const vars = txnsVars(CARD, false, ctx);
    expect(vars).toEqual({ cardUniqueId: 'CARD-1', month: '1', year: '2024' });
  });

  it('txnsVars advances the month by the cursor offset', () => {
    const ctx = ctxWith(new Date(2024, 0, 15));
    const vars = txnsVars(CARD, 2, ctx);
    expect(vars).toEqual({ cardUniqueId: 'CARD-1', month: '3', year: '2024' });
  });

  it('txnsExtractPage flattens bankAccounts[].debitDates[].transactions[]', () => {
    const body = {
      result: { bankAccounts: [{ debitDates: [{ transactions: [{ id: 't1' }, { id: 't2' }] }] }] },
    };
    const page = txnsExtractPage({
      body,
      cursor: false,
      acct: CARD,
      ctx: ctxWith(new Date(2000, 0, 1), 0),
    });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(1);
  });

  it('txnsExtractPage also includes immidiateDebits.debitDays[].transactions[]', () => {
    const body = {
      result: {
        bankAccounts: [
          {
            debitDates: [{ transactions: [{ id: 'r1' }] }],
            immidiateDebits: { debitDays: [{ transactions: [{ id: 'i1' }, { id: 'i2' }] }] },
          },
        ],
      },
    };
    const page = txnsExtractPage({
      body,
      cursor: false,
      acct: CARD,
      ctx: ctxWith(new Date(2000, 0, 1), 0),
    });
    expect(page.items).toHaveLength(3);
  });

  it('txnsExtractPage tolerates the result:null incomplete-cycle response', () => {
    const page = txnsExtractPage({
      body: { result: null },
      cursor: false,
      acct: CARD,
      ctx: ctxWith(new Date(2000, 0, 1), 0),
    });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(1);
  });

  describe('cursor window (frozen clock)', () => {
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW);
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it('txnsExtractPage stops when the window is exhausted', () => {
      const page = txnsExtractPage({
        body: {},
        cursor: OPEN_CYCLE_OFFSET,
        acct: CARD,
        ctx: ctxWith(NOW, 0),
      });
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBe(false);
    });

    it('reaches the still-open billing cycle when futureMonthsToScrape is 0', () => {
      const page = txnsExtractPage({
        body: {},
        cursor: false,
        acct: CARD,
        ctx: ctxWith(NOW, 0),
      });
      expect(page.nextCursor).toBe(OPEN_CYCLE_OFFSET);
    });

    it('futureMonthsToScrape above the open cycle still widens the window', () => {
      const page = txnsExtractPage({
        body: {},
        cursor: OPEN_CYCLE_OFFSET,
        acct: CARD,
        ctx: ctxWith(NOW, 3),
      });
      expect(page.nextCursor).toBe(OPEN_CYCLE_OFFSET + 1);
    });
  });
});

describe('VISACAL_SHAPE wiring', () => {
  it('declares POST for the customer + transactions CAL calls', () => {
    expect(VISACAL_SHAPE.customer.method).toBe('POST');
    expect(VISACAL_SHAPE.transactions.method).toBe('POST');
  });

  it('skips the balance fetch (card-cycle)', () => {
    expect(VISACAL_SHAPE.balance.skipFetch).toBe(true);
  });

  it('carries the VisaCalScrape step name', () => {
    expect(VISACAL_SHAPE.stepName).toBe('VisaCalScrape');
  });
});

/**
 * A CAL credit row at the shape the API actually sends: `trnAmt` is an
 * UNSIGNED magnitude and the minus lives on `amtBeforeConvAndIndex`. The real
 * payload also carries `refundInd: true`, `trnTypeCode: "6"` and
 * `trnType: "זיכוי"`, none of which the mapper reads — the sign disagreement
 * between the two amount fields is what identifies the row as a credit.
 * Values are synthetic; only the shape is real.
 */
const CREDIT_ROW = {
  trnIntId: 'CREDIT-1',
  trnPurchaseDate: '2026-01-12T17:07:00',
  merchantName: 'MERCHANT',
  trnAmt: 250,
  amtBeforeConvAndIndex: -250,
  refundInd: true,
  trnTypeCode: '6',
};

/**
 * An ordinary charge that happens to carry a non-default `trnTypeCode`. In
 * the real payload `trnTypeCode: "9"` rows are charges with
 * `refundInd: false` — the code is NOT a credit marker.
 */
const CHARGE_ROW = {
  trnIntId: 'CHARGE-1',
  trnPurchaseDate: '2026-01-13T10:00:00',
  merchantName: 'MERCHANT',
  trnAmt: 180.5,
  amtBeforeConvAndIndex: 180.5,
  refundInd: false,
  trnTypeCode: '9',
};

/**
 * Run one raw CAL row through the shape's own page extractor and then the
 * mapper, as a VisaCal scrape does — so the shape's `isCardIssuer`
 * declaration is what decides the sign, not a payload sniff.
 *
 * @param row - Raw CAL transaction row.
 * @returns The mapped transaction.
 */
function scrapeRow(row: Record<string, unknown>): ITransaction {
  const body = { result: { bankAccounts: [{ debitDates: [{ transactions: [row] }] }] } };
  const ctx = ctxWith(new Date(2000, 0, 1), 0);
  const page = txnsExtractPage({ body, cursor: false, acct: CARD, ctx });
  const mapped = autoMapTransaction(page.items[0] as ApiRecord, VISACAL_SHAPE.isCardIssuer);
  if (mapped === false) throw new TypeError('row was rejected by the mapper');
  return mapped;
}

describe('VisaCal charge sign, end to end through the shape', () => {
  it('declares itself a card issuer', () => {
    expect(VISACAL_SHAPE.isCardIssuer).toBe(true);
  });

  it('books a charge as money spent', () => {
    const txn = scrapeRow(CHARGE_ROW);
    expect(txn.chargedAmount).toBe(-180.5);
    expect(txn.originalAmount).toBe(-180.5);
  });

  it('books a credit as money returned, in BOTH amount fields', () => {
    // CAL leaves `trnAmt` unsigned, so inverting it alone booked this refund
    // as a 250 expense while `originalAmount` came out +250 — a row that
    // contradicted itself. Both fields must land on the same side.
    const txn = scrapeRow(CREDIT_ROW);
    expect(txn.chargedAmount).toBe(250);
    expect(txn.originalAmount).toBe(250);
  });
});
