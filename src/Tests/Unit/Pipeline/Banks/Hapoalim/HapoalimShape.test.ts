/**
 * Hapoalim hard-model scrape shape — unit coverage for the account,
 * balance, and transactions extractors + the ServerServices urlTag
 * builders + the anti-replay header set.
 *
 * Bodies are synthetic (structural only, fake values) so the test is
 * self-contained and carries zero PII. Field paths mirror the captured
 * contract (top-level accounts array, balanceAndCreditLimit.currentBalance,
 * transactions[]).
 */

import { HAPOALIM_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimShape.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceUrl,
  customerUrl,
  extractAccounts,
  type IHapoalimAcct,
} from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimShapeHelpers.js';
import {
  txnsExtractPage,
  txnsHeaders,
  txnsUrl,
} from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimShapeTxns.js';
import type {
  ApiBody,
  IExtractAccountsArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const ACCT: IHapoalimAcct = { composite: '12-170-536347' };

/**
 * Wrap a raw response body in the extractAccounts args bundle.
 * @param body - Synthetic response body.
 * @returns Extract-accounts args bundle.
 */
function accountsArgs(body: ApiBody): IExtractAccountsArgs {
  return { body, sessionContext: {} };
}

/**
 * Minimal action context carrying a fixed local startDate.
 * @returns Action context with startDate = 2026-06-04 (local).
 */
function ctxWithStart(): IActionContext {
  return { options: { startDate: new Date(2026, 5, 4) } } as unknown as IActionContext;
}

describe('HapoalimShape helpers', () => {
  it('extractAccounts builds the composite id from open accounts', () => {
    const body = [
      { bankNumber: 12, branchNumber: 170, accountNumber: 536347, accountClosingReasonCode: 0 },
    ];
    const args = accountsArgs(body as unknown as ApiBody);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ composite: '12-170-536347' }]);
  });

  it('extractAccounts excludes closed accounts (closing-reason !== 0)', () => {
    const body = [
      { bankNumber: 12, branchNumber: 170, accountNumber: 111, accountClosingReasonCode: 0 },
      { bankNumber: 12, branchNumber: 170, accountNumber: 222, accountClosingReasonCode: 5 },
    ];
    const args = accountsArgs(body as unknown as ApiBody);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ composite: '12-170-111' }]);
  });

  it('extractAccounts returns empty list when the payload is absent', () => {
    const args = accountsArgs(undefined as unknown as ApiBody);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([]);
  });

  it('accountNumberOf returns the composite id', () => {
    const number = accountNumberOf(ACCT);
    expect(number).toBe('12-170-536347');
  });

  it('balanceExtract prefers currentBalance', () => {
    const balance = balanceExtract({ currentBalance: 150, withdrawalBalance: 999 });
    expect(balance).toBe(150);
  });

  it('balanceExtract falls back to withdrawal then 0', () => {
    const withdrawal = balanceExtract({ withdrawalBalance: 42 });
    const missing = balanceExtract({});
    expect(withdrawal).toBe(42);
    expect(missing).toBe(0);
  });

  it('customerUrl is the static ServerServices accounts endpoint', () => {
    const url = customerUrl();
    expect(url).toBe('https://login.bankhapoalim.co.il/ServerServices/general/accounts?lang=he');
  });

  it('balanceUrl embeds the composite as partyCurrentAccount', () => {
    const url = balanceUrl(ACCT);
    expect(url).toBe(
      'https://login.bankhapoalim.co.il/ServerServices/current-account/composite/' +
        'balanceAndCreditLimit?partyCurrentAccount=12-170-536347&lang=he',
    );
  });
});

describe('HapoalimShape transactions', () => {
  it('txnsUrl carries the full-window query params + composite accountId', () => {
    const ctx = ctxWithStart();
    const url = txnsUrl(ACCT, false, ctx);
    expect(url).toContain(
      'https://login.bankhapoalim.co.il/ServerServices/current-account/transactions?',
    );
    expect(url).toContain('numItemsPerPage=1000&sortCode=1');
    expect(url).toContain('retrievalStartDate=20260604');
    expect(url).toContain('accountId=12-170-536347&lang=he');
    expect(url).toMatch(/retrievalEndDate=\d{8}/);
  });

  it('txnsHeaders declares the anti-replay set (cookie-echo XSRF + pageUuid)', () => {
    const headers = txnsHeaders();
    expect(headers['content-type']).toBe('application/json;charset=UTF-8');
    expect(headers['X-XSRF-TOKEN']).toBe('@cookie:XSRF-TOKEN');
    expect(headers.pageUuid).toBe('/current-account/transactions');
    expect(headers.uuid).toMatch(/[0-9a-f-]{36}/);
  });

  it('txnsExtractPage returns raw transactions rows and a terminal cursor', () => {
    const body = { transactions: [{ eventAmount: -50 }, { eventAmount: 120 }] };
    const ctx = ctxWithStart();
    const page = txnsExtractPage({ body, cursor: false, acct: ACCT, ctx });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(false);
  });

  it('txnsExtractPage yields an empty page when transactions are absent', () => {
    const ctx = ctxWithStart();
    const page = txnsExtractPage({ body: {}, cursor: false, acct: ACCT, ctx });
    expect(page.items).toEqual([]);
  });
});

describe('HAPOALIM_SHAPE wiring', () => {
  it('declares GET for accounts + balance and POST for transactions', () => {
    expect(HAPOALIM_SHAPE.customer.method).toBe('GET');
    expect(HAPOALIM_SHAPE.balance.method).toBe('GET');
    expect(HAPOALIM_SHAPE.transactions.method).toBe('POST');
  });

  it('carries the HapoalimScrape step name', () => {
    expect(HAPOALIM_SHAPE.stepName).toBe('HapoalimScrape');
  });
});
