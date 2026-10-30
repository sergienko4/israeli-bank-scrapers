/**
 * Max hard-model scrape shape — unit coverage for the card, balance, and
 * per-card/per-month transactions extractors + the getHomePageData /
 * getTransactionsAndGraphs GET URLs, the per-call headers, the month-offset
 * cursor, and the per-card row filter.
 *
 * Bodies are synthetic (structural only, fake values) so the test is
 * self-contained and carries zero PII. Field paths mirror the captured Max
 * trace (Result.UserCards.Cards[].Last4Digits; result.transactions[] rows
 * carrying shortCardNumber).
 */

import { jest } from '@jest/globals';

import { MAX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Max/scrape/MaxShape.js';
import {
  accountNumberOf,
  customerUrl,
  extractCards,
  type IMaxCard,
} from '../../../../../Scrapers/Pipeline/Banks/Max/scrape/MaxShapeHelpers.js';
import {
  txnsExtractPage,
  txnsUrl,
} from '../../../../../Scrapers/Pipeline/Banks/Max/scrape/MaxShapeTxns.js';
import type {
  ApiBody,
  IExtractAccountsArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const CARD: IMaxCard = { last4: '1234', cycleDebit: 0 };

const MAX_API = 'https://www.max.co.il/api/registered';

/** A v4 UUID, as `randomUUID()` produces. */
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/;

/**
 * Wrap a raw response body in the extractAccounts args bundle.
 * @param body - Synthetic response body.
 * @returns Extract-accounts args bundle.
 */
function accountsArgs(body: ApiBody): IExtractAccountsArgs {
  return { body, sessionContext: {} };
}

/**
 * Action context carrying startDate + the post-login session context.
 * @param startDate - Window start.
 * @param sid - Session id the login stored.
 * @returns Action context whose mediator session-context carries the sid.
 */
function ctxWithSession(startDate: Date, sid: string): IActionContext {
  const session = { flowId: sid };
  const mediator = { getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => session) };
  return { options: { startDate }, apiMediator: some(mediator) } as unknown as IActionContext;
}

/**
 * Headers the shape sends on a call.
 * @param ctx - Action context.
 * @returns The customer step's headers.
 */
function headersFor(ctx: IActionContext): Readonly<Record<string, string>> {
  const headers = MAX_SHAPE.customer.extraHeaders;
  if (typeof headers !== 'function') throw new TypeError('Max headers must be per-call');
  return headers(ctx);
}

/**
 * Action context with no mediator (before login) + optional
 * futureMonths (0 pins lastOffset for deterministic cursor-termination tests).
 * @param startDate - Window start.
 * @param futureMonthsToScrape - Future months.
 * @returns Action context.
 */
function ctxBeforeLogin(startDate: Date, futureMonthsToScrape?: number): IActionContext {
  const options = { startDate, futureMonthsToScrape };
  return { options, apiMediator: none } as unknown as IActionContext;
}

describe('MaxShape helpers', () => {
  it('extractCards reads Result.UserCards.Cards into card refs', () => {
    const cards = [{ Last4Digits: '1234' }, { Last4Digits: '9999' }];
    const args = accountsArgs({ Result: { UserCards: { Cards: cards } } });
    const accounts = extractCards(args);
    expect(accounts).toEqual([
      { last4: '1234', cycleDebit: 0 },
      { last4: '9999', cycleDebit: 0 },
    ]);
  });

  it('extractCards carries each card its own ILS cycle debit', () => {
    const cards = [
      { Last4Digits: '1234', CycleSummary: [{ Currency: 376, TotalDebitSum: 13.84 }] },
      { Last4Digits: '9999', CycleSummary: [{ Currency: 376, TotalDebitSum: 250.5 }] },
    ];
    const args = accountsArgs({ Result: { UserCards: { Cards: cards } } });
    const accounts = extractCards(args);
    expect(accounts).toEqual([
      { last4: '1234', cycleDebit: 13.84 },
      { last4: '9999', cycleDebit: 250.5 },
    ]);
  });

  it('extractCards returns empty list when UserCards is absent', () => {
    const args = accountsArgs({ Result: {} });
    const accounts = extractCards(args);
    expect(accounts).toEqual([]);
  });

  it('accountNumberOf returns the card last-4', () => {
    const number = accountNumberOf(CARD);
    expect(number).toBe('1234');
  });

  it('balance extract reports the card its own outstanding ILS cycle debit', () => {
    const card: IMaxCard = { last4: '1234', cycleDebit: 13.84 };
    const balance = MAX_SHAPE.balance.extract({}, card);
    expect(balance).toBe(13.84);
  });

  it('balance extract distinguishes two cards rather than repeating a total', () => {
    const first = MAX_SHAPE.balance.extract({}, { last4: '1234', cycleDebit: 13.84 });
    const second = MAX_SHAPE.balance.extract({}, { last4: '9999', cycleDebit: 250.5 });
    expect(first).toBe(13.84);
    expect(second).toBe(250.5);
  });

  it('balance extract falls back to 0 when the card carries no cycle debit', () => {
    const balance = MAX_SHAPE.balance.extract({}, CARD);
    expect(balance).toBe(0);
  });

  it('customerUrl targets getHomePageData', () => {
    const raw = customerUrl();
    const url = String(raw);
    expect(url).toBe(`${MAX_API}/getHomePageData?disableDefaultSpinnerBehavior=true`);
  });
});

describe('MaxShape headers', () => {
  it('sends the static set, the session id and a fresh call id', async () => {
    const { MAX_STATIC_HEADERS: statics } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigMaxConstants.js');
    const ctx = ctxWithSession(new Date(), 'SID-1');
    const first = headersFor(ctx);
    const second = headersFor(ctx);
    expect(first).toEqual({ ...statics, sid: 'SID-1', cid: first.cid });
    expect(first.cid).toMatch(UUID_PATTERN);
    expect(second.cid).not.toBe(first.cid);
  });

  it('sends an empty session id before login has stored one', () => {
    const ctx = ctxBeforeLogin(new Date());
    const headers = headersFor(ctx);
    expect(headers.sid).toBe('');
  });

  it('sends the same headers on the transactions call', () => {
    const { customer, transactions } = MAX_SHAPE;
    expect(typeof transactions.extraHeaders).toBe('function');
    expect(transactions.extraHeaders).toBe(customer.extraHeaders);
  });
});

describe('MaxShape transactions', () => {
  it('txnsUrl encodes the show-all filterData with a YYYY-M-01 date (cursor 0)', () => {
    const ctx = ctxWithSession(new Date(2026, 3, 15), 'SID-1');
    const raw = txnsUrl(CARD, false, ctx);
    const url = new URL(String(raw));
    const filterData = url.searchParams.get('filterData') ?? '';
    const parsed = JSON.parse(filterData) as { date: string; monthView: boolean };
    expect(parsed.date).toBe('2026-4-01');
    expect(parsed.monthView).toBe(true);
    const keys = [...url.searchParams.keys()];
    expect(keys).toEqual(['filterData', 'firstCallCardIndex']);
    const cardIndex = url.searchParams.get('firstCallCardIndex');
    expect(cardIndex).toBe('-1');
  });

  it('txnsUrl advances the filterData date month by the cursor offset', () => {
    const ctx = ctxWithSession(new Date(2026, 3, 15), 'SID-1');
    const raw = txnsUrl(CARD, 2, ctx);
    const url = String(raw);
    const filterData = new URL(url).searchParams.get('filterData') ?? '';
    const parsed = JSON.parse(filterData) as { date: string };
    expect(parsed.date).toBe('2026-6-01');
  });

  it('txnsExtractPage filters merged rows to the account card', () => {
    const rows = [
      { shortCardNumber: '1234', id: 'a' },
      { shortCardNumber: '9999', id: 'b' },
    ];
    const ctx = ctxBeforeLogin(new Date(2000, 0, 1), 0);
    const page = txnsExtractPage({
      body: { result: { transactions: rows } },
      cursor: false,
      acct: CARD,
      ctx,
    });
    expect(page.items).toEqual([{ shortCardNumber: '1234', id: 'a' }]);
    expect(page.nextCursor).toBe(1);
  });

  it('txnsExtractPage tolerates a null result block', () => {
    const ctx = ctxBeforeLogin(new Date(2000, 0, 1), 0);
    const page = txnsExtractPage({ body: { result: null }, cursor: false, acct: CARD, ctx });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(1);
  });

  it('txnsExtractPage stops when the window is exhausted', () => {
    const ctx = ctxBeforeLogin(new Date(), 0);
    const page = txnsExtractPage({ body: {}, cursor: false, acct: CARD, ctx });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(false);
  });
});

describe('MAX_SHAPE wiring', () => {
  it('declares GET for the customer + transactions calls', () => {
    expect(MAX_SHAPE.customer.method).toBe('GET');
    expect(MAX_SHAPE.transactions.method).toBe('GET');
  });

  it('skips the balance fetch (card-cycle)', () => {
    expect(MAX_SHAPE.balance.skipFetch).toBe(true);
  });

  it('carries the MaxScrape step name', () => {
    expect(MAX_SHAPE.stepName).toBe('MaxScrape');
  });
});
