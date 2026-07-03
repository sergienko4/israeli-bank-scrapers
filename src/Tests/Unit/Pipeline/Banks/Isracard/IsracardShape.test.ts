/**
 * Isracard hard-model scrape shape — unit coverage for the card, balance,
 * and per-card/per-month transactions extractors + the DigitalV3 POST
 * bodies, URLs, and month-offset cursor.
 *
 * Bodies are synthetic (structural only, fake values) so the test is
 * self-contained and carries zero PII. Field paths mirror the captured
 * Isracard trace (data.cardsList string-encoded; data.approvals.
 * approvedTransactions, data.israelAbroadVouchers.vouchers.
 * israelAbroadVouchersList). Isracard shares the DigitalV3 backbone with
 * Amex; only the host (web.isracard.co.il) differs.
 */

import { ISRACARD_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Isracard/scrape/IsracardShape.js';
import {
  accountNumberOf,
  customerUrl,
  customerVars,
  extractCards,
  type IIsracardCard,
} from '../../../../../Scrapers/Pipeline/Banks/Isracard/scrape/IsracardShapeHelpers.js';
import {
  txnsExtractPage,
  txnsUrl,
  txnsVars,
} from '../../../../../Scrapers/Pipeline/Banks/Isracard/scrape/IsracardShapeTxns.js';
import type {
  ApiBody,
  IExtractAccountsArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const CARD: IIsracardCard = { cardSuffix: '1234', companyCode: '11' };

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

/**
 * Wrap a stringified cardsList in the GetCardList envelope.
 * @param cards - Raw card rows to string-encode (production shape).
 * @returns Synthetic GetCardList response body.
 */
function cardListBody(cards: readonly object[]): ApiBody {
  const cardsList = JSON.stringify(cards);
  return { data: { cardsList } };
}

describe('IsracardShape helpers', () => {
  it('extractCards parses the string-encoded cardsList into card refs', () => {
    const body = cardListBody([{ cardSuffix: '1234', companyCode: '11' }]);
    const args = accountsArgs(body);
    const accounts = extractCards(args);
    expect(accounts).toEqual([{ cardSuffix: '1234', companyCode: '11' }]);
  });

  it('extractCards coerces a numeric companyCode to a string', () => {
    const body = cardListBody([{ cardSuffix: '9921', companyCode: 11 }]);
    const args = accountsArgs(body);
    const accounts = extractCards(args);
    expect(accounts[0]).toEqual({ cardSuffix: '9921', companyCode: '11' });
  });

  it('extractCards tolerates an already-parsed array (defensive)', () => {
    const body = { data: { cardsList: [{ cardSuffix: '0786', companyCode: '11' }] } };
    const args = accountsArgs(body);
    const accounts = extractCards(args);
    expect(accounts).toEqual([{ cardSuffix: '0786', companyCode: '11' }]);
  });

  it('extractCards returns empty list when cardsList is missing', () => {
    const args = accountsArgs({ data: {} });
    const accounts = extractCards(args);
    expect(accounts).toEqual([]);
  });

  it('extractCards returns empty list on malformed cardsList JSON', () => {
    const args = accountsArgs({ data: { cardsList: '{not-json' } });
    const accounts = extractCards(args);
    expect(accounts).toEqual([]);
  });

  it('accountNumberOf returns the card last-4', () => {
    const number = accountNumberOf(CARD);
    expect(number).toBe('1234');
  });

  it('balance extract is a deterministic 0 (card-cycle, no balance call)', () => {
    const balance = ISRACARD_SHAPE.balance.extract({});
    expect(balance).toBe(0);
  });

  it('customerVars carries the fixed GetCardList query', () => {
    const vars = customerVars();
    expect(vars).toEqual({ companyCode: '99', cardSuffixLength: 4 });
  });

  it('customerUrl is the static DigitalV3 GetCardList endpoint', () => {
    const url = customerUrl();
    expect(url).toBe(
      'https://web.isracard.co.il/ocp/transactions/DigitalV3.Transactions/GetCardList',
    );
  });
});

describe('IsracardShape transactions', () => {
  it('txnsUrl targets the static GetTransactionsList endpoint', () => {
    const url = txnsUrl();
    expect(url).toBe(
      'https://web.isracard.co.il/ocp/transactions/DigitalV3.Transactions/GetTransactionsList',
    );
  });

  it('txnsVars builds the window-start billing month (cursor 0)', () => {
    const ctx = ctxWith(new Date(2026, 5, 15));
    const vars = txnsVars(CARD, false, ctx);
    expect(vars).toEqual({
      card4Number: '1234',
      isNextBillingDate: true,
      cardStatus: 0,
      billingMonth: '01/06/2026',
      companyCode: 11,
      isPartner: false,
    });
  });

  it('txnsVars advances billingMonth by the cursor offset', () => {
    const ctx = ctxWith(new Date(2026, 5, 15));
    const vars = txnsVars(CARD, 2, ctx);
    expect(vars).toMatchObject({ billingMonth: '01/08/2026', companyCode: 11 });
  });

  it('txnsExtractPage merges approvals + vouchers + current containers', () => {
    const body = {
      data: {
        approvals: { approvedTransactions: [{ id: 'a1' }] },
        israelAbroadVouchers: {
          vouchers: { israelAbroadVouchersList: [{ id: 'v1' }, { id: 'v2' }] },
        },
        currentTransactionsList: [{ id: 'c1' }],
      },
    };
    const ctx = ctxWith(new Date(2000, 0, 1), 0);
    const page = txnsExtractPage({ body, cursor: false, acct: CARD, ctx });
    expect(page.items).toHaveLength(4);
    expect(page.nextCursor).toBe(1);
  });

  it('txnsExtractPage tolerates a null data block', () => {
    const ctx = ctxWith(new Date(2000, 0, 1), 0);
    const page = txnsExtractPage({ body: { data: null }, cursor: false, acct: CARD, ctx });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(1);
  });

  it('txnsExtractPage stops when the window is exhausted', () => {
    const ctx = ctxWith(new Date(), 0);
    const page = txnsExtractPage({ body: {}, cursor: false, acct: CARD, ctx });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBe(false);
  });
});

describe('ISRACARD_SHAPE wiring', () => {
  it('declares POST for the customer + transactions DigitalV3 calls', () => {
    expect(ISRACARD_SHAPE.customer.method).toBe('POST');
    expect(ISRACARD_SHAPE.transactions.method).toBe('POST');
  });

  it('skips the balance fetch (card-cycle)', () => {
    expect(ISRACARD_SHAPE.balance.skipFetch).toBe(true);
  });

  it('carries the IsracardScrape step name', () => {
    expect(ISRACARD_SHAPE.stepName).toBe('IsracardScrape');
  });
});
