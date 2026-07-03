/**
 * Max hard-model scrape shape — unit coverage for the card, balance, and
 * per-card/per-month transactions extractors + the getHomePageData /
 * getTransactionsAndGraphs GET URLs (version-tagged), the month-offset cursor,
 * and the per-card row filter.
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

const CARD: IMaxCard = { last4: '1234' };

/**
 * Wrap a raw response body in the extractAccounts args bundle.
 * @param body - Synthetic response body.
 * @returns Extract-accounts args bundle.
 */
function accountsArgs(body: ApiBody): IExtractAccountsArgs {
  return { body, sessionContext: {} };
}

/**
 * Action context carrying startDate + a discovered client version.
 * @param startDate - Window start.
 * @param version - Discovered SPA build version.
 * @returns Action context whose mediator session-context carries the version.
 */
function ctxWithVersion(startDate: Date, version: string): IActionContext {
  const session = { clientVersion: version };
  const mediator = { getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => session) };
  return { options: { startDate }, apiMediator: some(mediator) } as unknown as IActionContext;
}

/**
 * Action context with no mediator (no version discovered) + optional
 * futureMonths (0 pins lastOffset for deterministic cursor-termination tests).
 * @param startDate - Window start.
 * @param futureMonthsToScrape - Future months.
 * @returns Action context.
 */
function ctxNoVersion(startDate: Date, futureMonthsToScrape?: number): IActionContext {
  const options = { startDate, futureMonthsToScrape };
  return { options, apiMediator: none } as unknown as IActionContext;
}

describe('MaxShape helpers', () => {
  it('extractCards reads Result.UserCards.Cards into card refs', () => {
    const cards = [{ Last4Digits: '1234' }, { Last4Digits: '9999' }];
    const args = accountsArgs({ Result: { UserCards: { Cards: cards } } });
    const accounts = extractCards(args);
    expect(accounts).toEqual([{ last4: '1234' }, { last4: '9999' }]);
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

  it('balance extract is a deterministic 0 (card-cycle, no balance call)', () => {
    const balance = MAX_SHAPE.balance.extract({});
    expect(balance).toBe(0);
  });

  it('customerUrl targets getHomePageData with the version param', () => {
    const ctx = ctxWithVersion(new Date(), 'V4-TEST');
    const raw = customerUrl(ctx);
    const url = String(raw);
    expect(url).toContain('/api/registered/getHomePageData?disableDefaultSpinnerBehavior=true');
    expect(url).toContain('&v=V4-TEST');
  });

  it('customerUrl omits the version when none is discovered', () => {
    const ctx = ctxNoVersion(new Date());
    const raw = customerUrl(ctx);
    const url = String(raw);
    expect(url).toContain('/getHomePageData?disableDefaultSpinnerBehavior=true');
    expect(url).not.toContain('&v=');
  });
});

describe('MaxShape transactions', () => {
  it('txnsUrl encodes filterData + firstCallCardIndex + version (cursor 0)', () => {
    const ctx = ctxWithVersion(new Date(2026, 3, 15), 'V4-TEST');
    const raw = txnsUrl(CARD, false, ctx);
    const url = String(raw);
    const json = JSON.stringify({ month: 4, year: 2026 });
    const filter = encodeURIComponent(json);
    expect(url).toContain(`getTransactionsAndGraphs?filterData=${filter}`);
    expect(url).toContain('&firstCallCardIndex=-1');
    expect(url).toContain('&v=V4-TEST');
  });

  it('txnsUrl advances the filterData month by the cursor offset', () => {
    const ctx = ctxWithVersion(new Date(2026, 3, 15), 'V4-TEST');
    const raw = txnsUrl(CARD, 2, ctx);
    const url = String(raw);
    const json = JSON.stringify({ month: 6, year: 2026 });
    const filter = encodeURIComponent(json);
    expect(url).toContain(`filterData=${filter}`);
  });

  it('txnsExtractPage filters merged rows to the account card', () => {
    const rows = [
      { shortCardNumber: '1234', id: 'a' },
      { shortCardNumber: '9999', id: 'b' },
    ];
    const ctx = ctxNoVersion(new Date(2000, 0, 1), 0);
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
    const ctx = ctxNoVersion(new Date(2000, 0, 1), 0);
    const page = txnsExtractPage({ body: { result: null }, cursor: false, acct: CARD, ctx });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(1);
  });

  it('txnsExtractPage stops when the window is exhausted', () => {
    const ctx = ctxNoVersion(new Date(), 0);
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
