/**
 * FIBI-sibling hard-model scrape shapes (Massad, OtsarHahayal, Pagi) —
 * cross-bank unit coverage for the shared FIBI Mataf/appsng contract.
 *
 * The three shapes are cloned from Beinleumi per the zero-cross-bank-import
 * convention and differ only by API host + step name, so ONE `it.each` over the
 * sibling registry exercises each bank's account-identity merge, balance
 * extractor, identity/balance urlTags, and transactions body — no per-bank
 * duplication. Bodies are synthetic (fake values) — zero PII.
 */

import massadShape from '../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShape.js';
import * as massadA from '../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShapeAccounts.js';
import * as massadH from '../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShapeHelpers.js';
import * as massadT from '../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShapeTxns.js';
import otsarShape from '../../../../Scrapers/Pipeline/Banks/OtsarHahayal/scrape/OtsarHahayalShape.js';
import * as otsarA from '../../../../Scrapers/Pipeline/Banks/OtsarHahayal/scrape/OtsarHahayalShapeAccounts.js';
import * as otsarH from '../../../../Scrapers/Pipeline/Banks/OtsarHahayal/scrape/OtsarHahayalShapeHelpers.js';
import * as otsarT from '../../../../Scrapers/Pipeline/Banks/OtsarHahayal/scrape/OtsarHahayalShapeTxns.js';
import pagiShape from '../../../../Scrapers/Pipeline/Banks/Pagi/scrape/PagiShape.js';
import * as pagiA from '../../../../Scrapers/Pipeline/Banks/Pagi/scrape/PagiShapeAccounts.js';
import * as pagiH from '../../../../Scrapers/Pipeline/Banks/Pagi/scrape/PagiShapeHelpers.js';
import * as pagiT from '../../../../Scrapers/Pipeline/Banks/Pagi/scrape/PagiShapeTxns.js';
import type {
  ApiBody,
  IApiDirectScrapeShape,
  IExtractAccountsArgs,
  IExtractPageArgs,
} from '../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IPage } from '../../../../Scrapers/Pipeline/Strategy/Fetch/Pagination.js';
import type { IActionContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';

interface IAcct {
  readonly accountNumber: string;
  readonly branch: string;
  readonly accountType: number;
}

interface ISibMod {
  extractAccounts(a: IExtractAccountsArgs): readonly IAcct[];
  accountNumberOf(a: IAcct): string;
  customerUrl(): string;
  secondaryUrl(): string;
  balanceExtract(b: ApiBody): number;
  balanceUrl(a: IAcct): string;
  noVars(): object;
  txnsUrl(): string;
  txnsVars(a: IAcct, c: false, ctx: IActionContext): { initialRequest: Record<string, unknown> };
  txnsExtractPage(a: IExtractPageArgs<IAcct, never>): IPage<object, never>;
}

interface ISib {
  readonly name: string;
  readonly api: string;
  readonly step: string;
  readonly shape: IApiDirectScrapeShape<IAcct, never>;
  readonly mod: ISibMod;
}

/**
 * Merge a bank's three scrape modules into one uniform accessor.
 * @param a - Accounts module namespace.
 * @param h - Helpers module namespace.
 * @param t - Transactions module namespace.
 * @returns Combined sibling module.
 */
function asMod(a: object, h: object, t: object): ISibMod {
  return Object.assign({}, a, h, t) as unknown as ISibMod;
}

const SIBLINGS: readonly ISib[] = [
  {
    name: 'Massad',
    api: massadH.MASSAD_API,
    step: 'MassadScrape',
    shape: massadShape,
    mod: asMod(massadA, massadH, massadT),
  },
  {
    name: 'OtsarHahayal',
    api: otsarH.OTSAR_HAHAYAL_API,
    step: 'OtsarHahayalScrape',
    shape: otsarShape,
    mod: asMod(otsarA, otsarH, otsarT),
  },
  {
    name: 'Pagi',
    api: pagiH.PAGI_API,
    step: 'PagiScrape',
    shape: pagiShape,
    mod: asMod(pagiA, pagiH, pagiT),
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
    const accounts = bank.mod.extractAccounts(args);
    expect(accounts).toEqual([{ accountNumber: '555001', branch: '770', accountType: 105 }]);
  });

  it('extractAccounts falls back to the whole list + accountType 0 when unmarked/absent', () => {
    const body = { accounts: [{ account: '555001', branch: '770' }] };
    const args = accountsArgs(body);
    const accounts = bank.mod.extractAccounts(args);
    expect(accounts).toEqual([{ accountNumber: '555001', branch: '770', accountType: 0 }]);
  });

  it('extractAccounts returns empty when userData accounts are absent', () => {
    const args = accountsArgs({});
    const accounts = bank.mod.extractAccounts(args);
    expect(accounts).toEqual([]);
  });

  it('extractAccounts defaults missing account/branch fields to empty strings', () => {
    const args = accountsArgs(
      { accounts: [{ selected: true }] },
      { accountType: [{ accountType: 105 }] },
    );
    const accounts = bank.mod.extractAccounts(args);
    expect(accounts).toEqual([{ accountNumber: '', branch: '', accountType: 105 }]);
  });

  it('balanceExtract prefers currentBalance, then withdrawable, then 0', () => {
    const primary = bank.mod.balanceExtract({ currentBalance: 150, withdrawableBalance: 999 });
    const fallback = bank.mod.balanceExtract({ withdrawableBalance: 42 });
    const zero = bank.mod.balanceExtract({});
    expect(primary).toBe(150);
    expect(fallback).toBe(42);
    expect(zero).toBe(0);
  });

  it('identity + balance urlTags target the bank host with a fresh uid', () => {
    const customer = bank.mod.customerUrl();
    const secondary = bank.mod.secondaryUrl();
    const balance = bank.mod.balanceUrl(ACCT);
    const customerAgain = bank.mod.customerUrl();
    expect(customer).toContain(`${bank.api}${USER_DATA}?uid=`);
    expect(secondary).toContain(`${bank.api}${BFF}/accountType?uid=`);
    expect(balance).toContain(`${BFF}/balances/105?uid=`);
    expect(customer).not.toBe(customerAgain);
  });

  it('accountNumberOf + noVars expose the display number and empty vars', () => {
    const number = bank.mod.accountNumberOf(ACCT);
    const vars = bank.mod.noVars();
    expect(number).toBe('555001');
    expect(vars).toEqual({});
  });

  it('txnsUrl is the static list endpoint and txnsVars builds the initialRequest', () => {
    const url = bank.mod.txnsUrl();
    const ctx = ctxWithStart();
    const vars = bank.mod.txnsVars(ACCT, false, ctx);
    const req = vars.initialRequest;
    expect(url).toBe(`${bank.api}${BFF}/list`);
    expect(req.accountNumber).toBe(555001);
    expect(req.accountType).toBe(105);
    expect(req.language).toBe('HEB');
  });

  it('txnsExtractPage returns raw rows (or empty) with a terminal cursor', () => {
    const ctx = ctxWithStart();
    const full = bank.mod.txnsExtractPage({
      body: { transactions: [{ x: 1 }] },
      cursor: false,
      acct: ACCT,
      ctx,
    });
    const empty = bank.mod.txnsExtractPage({ body: {}, cursor: false, acct: ACCT, ctx });
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
