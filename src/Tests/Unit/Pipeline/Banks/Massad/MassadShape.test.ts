/**
 * Massad (FIBI group) hard-model scrape shape — unit coverage for the
 * two-GET account-identity merge (userData + session accountType), the
 * balance extractor + balance urlTag, the identity urlTags (fresh uid),
 * and the transactions `initialRequest` POST body + page extractor.
 *
 * Contract shared with Beinleumi (same FIBI Mataf portal); cloned per the
 * zero-cross-bank-import convention. Bodies are synthetic (structural
 * only, fake values) so the test is self-contained and carries zero PII.
 * Field paths mirror the captured contract (userData.accounts[],
 * accountType[0].accountType, balances.currentBalance, transactions[]).
 */

import MASSAD_SHAPE from '../../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShape.js';
import {
  accountNumberOf,
  customerUrl,
  extractAccounts,
  secondaryUrl,
} from '../../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShapeAccounts.js';
import {
  balanceExtract,
  balanceUrl,
  BFF_BASE,
  type IMassadAcct,
  MASSAD_API,
  USER_DATA_PATH,
} from '../../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShapeHelpers.js';
import {
  txnsExtractPage,
  txnsUrl,
  txnsVars,
} from '../../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShapeTxns.js';
import type {
  ApiBody,
  IExtractAccountsArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const ACCT: IMassadAcct = { accountNumber: '555001', branch: '770', accountType: 105 };

/**
 * Wrap a userData body + optional accountType body in the extract args.
 * @param body - Synthetic userData response body.
 * @param secondaryBody - Synthetic accountType-lookup response body.
 * @returns Extract-accounts args bundle.
 */
function accountsArgs(body: ApiBody, secondaryBody?: ApiBody): IExtractAccountsArgs {
  return { body, sessionContext: {}, secondaryBody };
}

/**
 * Minimal action context carrying a fixed local startDate.
 * @returns Action context with startDate = 2026-06-04 (local).
 */
function ctxWithStart(): IActionContext {
  return { options: { startDate: new Date(2026, 5, 4) } } as unknown as IActionContext;
}

describe('MassadShape accounts', () => {
  it('extractAccounts merges the selected userData row with the session accountType', () => {
    const body = { accounts: [{ account: '555001', branch: '770', selected: true }] };
    const secondary = { accountType: [{ accountType: 105 }] };
    const args = accountsArgs(body, secondary);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ accountNumber: '555001', branch: '770', accountType: 105 }]);
  });

  it('extractAccounts keeps only the selected row when several are present', () => {
    const body = {
      accounts: [
        { account: '555001', branch: '770', selected: true },
        { account: '888888', branch: '099', selected: false },
      ],
    };
    const secondary = { accountType: [{ accountType: 105 }] };
    const args = accountsArgs(body, secondary);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ accountNumber: '555001', branch: '770', accountType: 105 }]);
  });

  it('extractAccounts falls back to the whole list when none is selected', () => {
    const body = { accounts: [{ account: '555001', branch: '770' }] };
    const secondary = { accountType: [{ accountType: 105 }] };
    const args = accountsArgs(body, secondary);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ accountNumber: '555001', branch: '770', accountType: 105 }]);
  });

  it('extractAccounts defaults accountType to 0 when the secondary body is absent', () => {
    const body = { accounts: [{ account: '555001', branch: '770', selected: true }] };
    const args = accountsArgs(body);
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ accountNumber: '555001', branch: '770', accountType: 0 }]);
  });

  it('extractAccounts returns an empty list when userData accounts are absent', () => {
    const args = accountsArgs({});
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([]);
  });

  it('accountNumberOf returns the display account number', () => {
    const number = accountNumberOf(ACCT);
    expect(number).toBe('555001');
  });
});

describe('MassadShape balance + identity urls', () => {
  it('balanceExtract prefers currentBalance, then withdrawable, then 0', () => {
    const primary = balanceExtract({ currentBalance: 150, withdrawableBalance: 999 });
    const fallback = balanceExtract({ withdrawableBalance: 42 });
    const zero = balanceExtract({});
    expect(primary).toBe(150);
    expect(fallback).toBe(42);
    expect(zero).toBe(0);
  });

  it('customerUrl targets userData with a fresh uid on each call', () => {
    const first = customerUrl();
    const second = customerUrl();
    expect(first).toContain(`${MASSAD_API}${USER_DATA_PATH}?uid=`);
    expect(first).not.toBe(second);
  });

  it('secondaryUrl targets the session accountType lookup', () => {
    const url = secondaryUrl();
    expect(url).toContain(`${MASSAD_API}${BFF_BASE}/accountType?uid=`);
  });

  it('balanceUrl embeds the numeric accountType as the path segment', () => {
    const url = balanceUrl(ACCT);
    expect(url).toContain(`${BFF_BASE}/balances/105?uid=`);
  });
});

describe('MassadShape transactions', () => {
  it('txnsUrl is the static BFF list endpoint (params ride the body)', () => {
    const url = txnsUrl();
    expect(url).toBe(`${MASSAD_API}${BFF_BASE}/list`);
  });

  it('txnsVars builds the initialRequest envelope with wire types + date window', () => {
    const ctx = ctxWithStart();
    const vars = txnsVars(ACCT, false, ctx);
    const req = vars.initialRequest as Record<string, unknown>;
    expect(req.accountNumber).toBe(555001);
    expect(req.branch).toBe('770');
    expect(req.accountType).toBe(105);
    expect(req.order).toBe(1);
    expect(req.language).toBe('HEB');
    expect(req.startDate).toBe('2026-06-04');
    expect(req.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('txnsExtractPage returns raw transactions rows and a terminal cursor', () => {
    const ctx = ctxWithStart();
    const body = { transactions: [{ creditAmount: 50 }, { debitAmount: 20 }] };
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

describe('MASSAD_SHAPE wiring', () => {
  it('declares GET accounts (with secondary identity) + GET balance + POST transactions', () => {
    expect(MASSAD_SHAPE.customer.method).toBe('GET');
    expect(MASSAD_SHAPE.customer.secondaryUrlTag).toBeDefined();
    expect(MASSAD_SHAPE.balance.method).toBe('GET');
    expect(MASSAD_SHAPE.transactions.method).toBe('POST');
  });

  it('carries the MassadScrape step name', () => {
    expect(MASSAD_SHAPE.stepName).toBe('MassadScrape');
  });

  it('declares no prime nav — AUTH-DISCOVERY handles the appsng session hand-off', () => {
    expect(MASSAD_SHAPE.prime).toBeUndefined();
  });
});
