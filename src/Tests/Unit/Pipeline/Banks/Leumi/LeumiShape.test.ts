/**
 * Leumi hard-model scrape shape — unit coverage for the accounts,
 * balance, and transactions extractors plus the WCF shape wiring.
 *
 * Bodies are synthetic (structural only, fake values) wrapped in Leumi's
 * `{ jsonResp: "<stringified>" }` WCF response envelope, so the test is
 * self-contained and carries zero PII. Field paths mirror the captured
 * Leumi fixtures (AccountsItems, BalanceDisplay, HistoryTransactionsItems).
 */

import { LEUMI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShape.js';
import {
  accountNumberOf,
  balanceExtract,
  extractAccounts,
  type ILeumiAcct,
} from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShapeHelpers.js';
import { txnsExtractPage } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShapeTxns.js';
import type {
  ApiBody,
  IExtractAccountsArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const ACCT: ILeumiAcct = { accountIndex: 3, displayNumber: '99-888/77' };

/**
 * Wrap an inner response object in Leumi's WCF `jsonResp` envelope.
 * @param inner - Synthetic inner response (fake values).
 * @returns Raw WCF response body.
 */
function wrap(inner: Record<string, unknown>): ApiBody {
  return { jsonResp: JSON.stringify(inner) };
}

/**
 * Bundle a raw body into the extract-accounts args.
 * @param body - Raw WCF response body.
 * @returns Extract-accounts args bundle.
 */
function accountsArgs(body: ApiBody): IExtractAccountsArgs {
  return { body, sessionContext: {} };
}

/**
 * Minimal action context (extractors read the body only).
 * @returns Empty action context cast.
 */
function fakeCtx(): IActionContext {
  return {} as unknown as IActionContext;
}

describe('LeumiShape helpers', () => {
  it('extractAccounts maps AccountIndex + MaskedNumber', () => {
    const body = wrap({ AccountsItems: [{ AccountIndex: 3, MaskedNumber: '99-888/77' }] });
    const args = accountsArgs(body);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ accountIndex: 3, displayNumber: '99-888/77' }]);
  });

  it('extractAccounts returns empty list when the envelope is absent', () => {
    const args = accountsArgs({});
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([]);
  });

  it('extractAccounts tolerates a malformed jsonResp', () => {
    const args = accountsArgs({ jsonResp: 'not-json' });
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([]);
  });

  it('accountNumberOf returns the masked display number', () => {
    const number = accountNumberOf(ACCT);
    expect(number).toBe('99-888/77');
  });

  it('balanceExtract reads BalanceDisplay', () => {
    const body = wrap({ BalanceDisplay: 4321.5 });
    const balance = balanceExtract(body);
    expect(balance).toBe(4321.5);
  });

  it('balanceExtract falls back to 0 when BalanceDisplay is absent', () => {
    const body = wrap({});
    const balance = balanceExtract(body);
    expect(balance).toBe(0);
  });
});

describe('LeumiShape transactions', () => {
  it('txnsExtractPage returns raw HistoryTransactionsItems + terminal cursor', () => {
    const inner = {
      HistoryTransactionsItems: [
        { DateUTC: 'Wed, 01 Jan 2025 00:00:00 GMT', Amount: 10 },
        { DateUTC: 'Thu, 02 Jan 2025 00:00:00 GMT', Amount: -20 },
      ],
      TodayTransactionsItems: null,
    };
    const body = wrap(inner);
    const page = txnsExtractPage({ body, cursor: false, acct: ACCT, ctx: fakeCtx() });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(false);
  });

  it('txnsExtractPage yields an empty page when the container is missing', () => {
    const body = wrap({});
    const page = txnsExtractPage({ body, cursor: false, acct: ACCT, ctx: fakeCtx() });
    expect(page.items).toEqual([]);
  });
});

describe('LEUMI_SHAPE wiring', () => {
  it('declares POST for all three WCF calls', () => {
    expect(LEUMI_SHAPE.customer.method).toBe('POST');
    expect(LEUMI_SHAPE.balance.method).toBe('POST');
    expect(LEUMI_SHAPE.transactions.method).toBe('POST');
  });

  it('carries the LeumiScrape step name', () => {
    expect(LEUMI_SHAPE.stepName).toBe('LeumiScrape');
  });
});
