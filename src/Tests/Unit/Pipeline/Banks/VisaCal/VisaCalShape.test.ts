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
import type {
  ApiBody,
  IExtractAccountsArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const CARD: IVisaCalCard = { cardUniqueId: 'CARD-1', displayNumber: '1234' };

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

  it('balance extract is a deterministic 0 (card-cycle, no balance call)', () => {
    const balance = VISACAL_SHAPE.balance.extract({});
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

  it('txnsExtractPage stops when the window is exhausted', () => {
    const page = txnsExtractPage({
      body: {},
      cursor: false,
      acct: CARD,
      ctx: ctxWith(new Date(), 0),
    });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(false);
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
