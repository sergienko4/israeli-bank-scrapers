/**
 * Mercantile hard-model scrape shape — unit coverage for the account,
 * balance, and transactions extractors + the Titan GET urlTag builders.
 *
 * Bodies are synthetic (structural only, fake values) so the test is
 * self-contained and carries zero PII. Field paths mirror the shared
 * Discount/Titan contract (UserAccountsData.UserAccounts,
 * AccountInfoAndBalance, CurrentAccountLastTransactions.OperationEntry).
 */

import { MERCANTILE_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Mercantile/scrape/MercantileShape.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceUrl,
  customerUrl,
  extractAccounts,
  type IMercantileAcct,
} from '../../../../../Scrapers/Pipeline/Banks/Mercantile/scrape/MercantileShapeHelpers.js';
import {
  txnsExtractPage,
  txnsUrl,
} from '../../../../../Scrapers/Pipeline/Banks/Mercantile/scrape/MercantileShapeTxns.js';
import type {
  ApiBody,
  IExtractAccountsArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const ACCT: IMercantileAcct = { accountId: 'ACCT-1', displayNumber: '12-345-6' };

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
 * @returns Action context with startDate = 2024-01-15 (local).
 */
function ctxWithStart(): IActionContext {
  return { options: { startDate: new Date(2024, 0, 15) } } as unknown as IActionContext;
}

describe('MercantileShape helpers', () => {
  it('extractAccounts maps AccountID (path) + FormatAccountID (display)', () => {
    const body = {
      UserAccountsData: {
        UserAccounts: [{ NewAccountInfo: { AccountID: 'ACCT-1' }, FormatAccountID: '12-345-6' }],
      },
    };
    const args = accountsArgs(body);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ accountId: 'ACCT-1', displayNumber: '12-345-6' }]);
  });

  it('extractAccounts falls back to accountId when FormatAccountID is absent', () => {
    const body = { UserAccountsData: { UserAccounts: [{ NewAccountInfo: { AccountID: 'X-9' } }] } };
    const args = accountsArgs(body);
    const accounts = extractAccounts(args);
    expect(accounts[0]).toEqual({ accountId: 'X-9', displayNumber: 'X-9' });
  });

  it('extractAccounts returns empty list when the container is missing', () => {
    const args = accountsArgs({});
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([]);
  });

  it('accountNumberOf returns the display number', () => {
    const number = accountNumberOf(ACCT);
    expect(number).toBe('12-345-6');
  });

  it('balanceExtract prefers AccountBalance', () => {
    const body = {
      AccountInfoAndBalance: { AccountBalance: 1234.5, AccountAvailableBalance: 1000 },
    };
    const balance = balanceExtract(body);
    expect(balance).toBe(1234.5);
  });

  it('balanceExtract falls back to available then 0', () => {
    const available = balanceExtract({ AccountInfoAndBalance: { AccountAvailableBalance: 42 } });
    const missing = balanceExtract({});
    expect(available).toBe(42);
    expect(missing).toBe(0);
  });

  it('customerUrl is the static Titan accounts endpoint', () => {
    const url = customerUrl();
    expect(url).toBe(
      'https://start.telebank.co.il/Titan/gatewayAPI/userAccountsData?FetchAccountsNickName=true&FirstTimeEntry=true',
    );
  });

  it('balanceUrl embeds the account path id', () => {
    const url = balanceUrl(ACCT);
    expect(url).toBe(
      'https://start.telebank.co.il/Titan/gatewayAPI/accountDetails/infoAndBalance/ACCT-1',
    );
  });
});

describe('MercantileShape transactions', () => {
  it('txnsUrl targets the full-history /Date endpoint with FromDate', () => {
    const ctx = ctxWithStart();
    const url = txnsUrl(ACCT, false, ctx);
    expect(url).toBe(
      'https://start.telebank.co.il/Titan/gatewayAPI/lastTransactions/transactions/ACCT-1/Date' +
        '?IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True' +
        '&IsFutureTransactionFlag=True&FromDate=20240115',
    );
  });

  it('txnsExtractPage returns raw OperationEntry rows and a terminal cursor', () => {
    const body = {
      CurrentAccountLastTransactions: {
        OperationEntry: [
          { OperationDate: '20240102', OperationAmount: -50 },
          { OperationDate: '20240103', OperationAmount: 120 },
        ],
      },
    };
    const ctx = ctxWithStart();
    const page = txnsExtractPage({ body, cursor: false, acct: ACCT, ctx });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(false);
  });

  it('txnsExtractPage yields an empty page when the container is missing', () => {
    const ctx = ctxWithStart();
    const page = txnsExtractPage({ body: {}, cursor: false, acct: ACCT, ctx });
    expect(page.items).toEqual([]);
  });
});

describe('MERCANTILE_SHAPE wiring', () => {
  it('declares GET for all three Titan calls', () => {
    expect(MERCANTILE_SHAPE.customer.method).toBe('GET');
    expect(MERCANTILE_SHAPE.balance.method).toBe('GET');
    expect(MERCANTILE_SHAPE.transactions.method).toBe('GET');
  });

  it('carries the MercantileScrape step name', () => {
    expect(MERCANTILE_SHAPE.stepName).toBe('MercantileScrape');
  });
});
