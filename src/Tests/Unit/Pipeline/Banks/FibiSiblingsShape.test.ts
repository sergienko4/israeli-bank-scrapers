/**
 * FIBI-sibling hard-model scrape shapes (Massad, OtsarHahayal, Pagi) —
 * cross-bank unit coverage for the shared FIBI Mataf/appsng contract.
 *
 * The three shapes are cloned from Beinleumi per the zero-cross-bank-import
 * convention and differ only by API host + step name, so ONE `describe.each` over
 * the sibling registry exercises each bank's account-identity merge, balance
 * extractor, identity/balance urlTags, and transactions body — no per-bank
 * duplication. Bodies are synthetic (fake values) — zero PII.
 */

import {
  accountNumberOf,
  customerUrl,
  extractAccounts,
  secondaryUrl,
} from '../../../../Scrapers/Pipeline/Banks/_Shared/FibiGroup/FibiGroupShapeAccounts.js';
import {
  balanceExtract,
  balanceUrl,
  noVars,
} from '../../../../Scrapers/Pipeline/Banks/_Shared/FibiGroup/FibiGroupShapeHelpers.js';
import {
  txnsExtractPage,
  txnsUrl,
  txnsVars,
} from '../../../../Scrapers/Pipeline/Banks/_Shared/FibiGroup/FibiGroupShapeTxns.js';
import massadShape from '../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShape.js';
import otsarShape from '../../../../Scrapers/Pipeline/Banks/OtsarHahayal/scrape/OtsarHahayalShape.js';
import pagiShape from '../../../../Scrapers/Pipeline/Banks/Pagi/scrape/PagiShape.js';
import type {
  ApiBody,
  IApiDirectScrapeShape,
  IExtractAccountsArgs,
} from '../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';

interface IAcct {
  readonly accountNumber: string;
  readonly branch: string;
  readonly accountType: number;
}

interface ISib {
  readonly name: string;
  readonly api: string;
  readonly step: string;
  readonly shape: IApiDirectScrapeShape<IAcct, never>;
  readonly cfg: { readonly apiOrigin: string };
}

const SIBLINGS: readonly ISib[] = [
  {
    name: 'Massad',
    api: 'https://online.bankmassad.co.il',
    step: 'MassadScrape',
    shape: massadShape,
    cfg: { apiOrigin: 'https://online.bankmassad.co.il' },
  },
  {
    name: 'OtsarHahayal',
    api: 'https://online.bankotsar.co.il',
    step: 'OtsarHahayalScrape',
    shape: otsarShape,
    cfg: { apiOrigin: 'https://online.bankotsar.co.il' },
  },
  {
    name: 'Pagi',
    api: 'https://online.pagi.co.il',
    step: 'PagiScrape',
    shape: pagiShape,
    cfg: { apiOrigin: 'https://online.pagi.co.il' },
  },
];

const ACCT: IAcct = { accountNumber: '555001', branch: '770', accountType: 105 };
const USER_DATA = '/MatafAngularRestApiService/rest/utils/userData';
const BFF = '/appsng/bff-balancetransactions/api/v1/transactions';

/**
 * Wrap userData + optional accountType bodies in the extract args.
 * @param body - Synthetic userData body.
 * @param secondaryBody - Synthetic accountType body.
 * @returns Extract-accounts args.
 */
function accountsArgs(body: ApiBody, secondaryBody?: ApiBody): IExtractAccountsArgs {
  return { body, sessionContext: {}, secondaryBody };
}

/**
 * Action context carrying a fixed local startDate.
 * @returns Action context (startDate 2026-06-04).
 */
function ctxWithStart(): IActionContext {
  return { options: { startDate: new Date(2026, 5, 4) } } as unknown as IActionContext;
}

describe.each(SIBLINGS)('$name FIBI-sibling shape', bank => {
  it('extractAccounts merges the selected userData row with the session accountType', () => {
    const body = {
      accounts: [
        { account: '555001', branch: '770', selected: true },
        { account: '8', branch: '9', selected: false },
      ],
    };
    const args = accountsArgs(body, { accountType: [{ accountType: 105 }] });
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ accountNumber: '555001', branch: '770', accountType: 105 }]);
  });

  it('extractAccounts falls back to the whole list when no row is marked selected', () => {
    const body = { accounts: [{ account: '555001', branch: '770' }] };
    const args = accountsArgs(body, { accountType: [{ accountType: 105 }] });
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ accountNumber: '555001', branch: '770', accountType: 105 }]);
  });

  it('extractAccounts rejects a row when the accountType lookup is absent', () => {
    const body = { accounts: [{ account: '555001', branch: '770' }] };
    const args = accountsArgs(body);
    expect(() => extractAccounts(args)).toThrow(/no usable type code/);
  });

  it('extractAccounts returns empty when userData accounts are absent', () => {
    const args = accountsArgs({});
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([]);
  });

  it('extractAccounts rejects a userData row carrying no account number', () => {
    const args = accountsArgs(
      { accounts: [{ selected: true }] },
      { accountType: [{ accountType: 105 }] },
    );
    expect(() => extractAccounts(args)).toThrow(/no wire-usable account number/);
  });

  it('extractAccounts rejects a userData row carrying no branch', () => {
    const args = accountsArgs(
      { accounts: [{ account: '555001', selected: true }] },
      { accountType: [{ accountType: 105 }] },
    );
    expect(() => extractAccounts(args)).toThrow(/missing its branch code/);
  });

  it('extractAccounts keeps a leading-zero branch as a string', () => {
    const args = accountsArgs(
      { accounts: [{ account: '555001', branch: '099', selected: true }] },
      { accountType: [{ accountType: 105 }] },
    );
    const accounts = extractAccounts(args);
    expect(accounts).toEqual([{ accountNumber: '555001', branch: '099', accountType: 105 }]);
  });

  it('balanceExtract prefers currentBalance, then withdrawable, then 0', () => {
    const primary = balanceExtract({ currentBalance: 150, withdrawableBalance: 999 });
    const fallback = balanceExtract({ withdrawableBalance: 42 });
    const zero = balanceExtract({});
    expect(primary).toBe(150);
    expect(fallback).toBe(42);
    expect(zero).toBe(0);
  });

  it('identity + balance urlTags target the bank host with a fresh uid', () => {
    const customer = customerUrl(bank.cfg);
    const secondary = secondaryUrl(bank.cfg);
    const balance = balanceUrl(bank.cfg, ACCT);
    const customerAgain = customerUrl(bank.cfg);
    expect(customer).toContain(`${bank.api}${USER_DATA}?uid=`);
    expect(secondary).toContain(`${bank.api}${BFF}/accountType?uid=`);
    expect(balance).toContain(`${BFF}/balances/105?uid=`);
    expect(customer).not.toBe(customerAgain);
  });

  it('accountNumberOf + noVars expose the display number and empty vars', () => {
    const number = accountNumberOf(ACCT);
    const vars = noVars();
    expect(number).toBe('555001');
    expect(vars).toEqual({});
  });

  it('txnsUrl is the static list endpoint and txnsVars builds the initialRequest', () => {
    const url = txnsUrl(bank.cfg);
    const ctx = ctxWithStart();
    const vars = txnsVars(ACCT, false, ctx);
    const req = vars.initialRequest as Record<string, unknown>;
    expect(url).toBe(`${bank.api}${BFF}/list`);
    expect(req.accountNumber).toBe(555001);
    expect(req.accountType).toBe(105);
    expect(req.language).toBe('HEB');
  });

  it('txnsExtractPage returns raw rows (or empty) with a terminal cursor', () => {
    const ctx = ctxWithStart();
    const full = txnsExtractPage({
      body: { transactions: [{ x: 1 }] },
      cursor: false,
      acct: ACCT,
      ctx,
    });
    const empty = txnsExtractPage({ body: {}, cursor: false, acct: ACCT, ctx });
    expect(full.items).toHaveLength(1);
    expect(full.nextCursor).toBe(false);
    expect(empty.items).toEqual([]);
  });

  it('the shape wires GET customer (+secondary) / GET balance / POST transactions', () => {
    expect(bank.shape.stepName).toBe(bank.step);
    expect(bank.shape.customer.method).toBe('GET');
    expect(bank.shape.customer.secondaryUrlTag).toBeDefined();
    expect(bank.shape.balance.method).toBe('GET');
    expect(bank.shape.transactions.method).toBe('POST');
  });
});
