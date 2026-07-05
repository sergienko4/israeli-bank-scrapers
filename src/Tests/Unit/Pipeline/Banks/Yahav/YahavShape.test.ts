/**
 * Yahav (TCS BaNCS Digital) hard-model scrape shape — unit coverage for the
 * envelope builder (static + dynamic fields, session-context SecToken +
 * portfolio refs), the accounts / balance / transactions Payload builders, the
 * account extractor, the BaNCS-normalized transactions page, and the shape
 * wiring.
 *
 * Captured values + response bodies are synthetic (structural only, fabricated
 * ids) so the test is self-contained and carries zero PII. Field paths mirror
 * the captured contract (Payload.DataEntity[].Account.AccountId, Prtflio.Id,
 * OrigDt filters, SecToken.Token[0]).
 */

import { extractYahavAccounts } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavAccountExtract.js';
import { YAHAV_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShape.js';
import {
  buildEnvelope,
  csrfHeaders,
  portfolioRefs,
} from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShapeEnvelope.js';
import { type IYahavAcct } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShapeHelpers.js';
import {
  accountsPayload,
  balancePayload,
} from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShapePayloads.js';
import { txnsPayload } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShapeTxnPayload.js';
import { txnsExtractPage } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShapeTxns.js';
import type {
  ApiBody,
  IExtractAccountsArgs,
  VarsMap,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const SEC_TOKEN = { Ver: 'SecurityToken_1.0.0', Token: [{ TokenId: 't-1', Signature: 'sig' }] };
const ACCT: IYahavAcct = { id: 'fakeacct00001', iorId: 'fakeIor', balance: 150 };
const APP_VER = 'BaNCSDigital.Web_1.3.46.BY.1.1.96.FP46';
const CHUNK = { start: '2026-06-25T00:00:00.000Z', end: '2026-07-02T23:59:59.000Z' };

/**
 * Action context whose mediator session-context yields the captured BaNCS
 * values; `overrides` replaces individual keys (e.g. an absent SecToken).
 * @param overrides - Session-context key overrides.
 * @param startDate - Scrape-window start (defaults to a fixed 2026-06-25).
 * @returns Action context with a populated apiMediator slot + startDate.
 */
function ctxWithBancs(overrides?: Record<string, unknown>, startDate?: Date): IActionContext {
  const session = {
    bancsSecToken: JSON.stringify(SEC_TOKEN),
    bancsPortfolioIorId: 'fakePior',
    bancsPortfolioId: 'fakeport0001',
    ...overrides,
  };
  const mediator = {
    /**
     * Session-context accessor returning the primed BaNCS values.
     * @returns Session-context bundle.
     */
    getSessionContext: (): Record<string, unknown> => session,
  };
  const slot = { has: true, value: mediator };
  const start = startDate ?? new Date(2026, 5, 25);
  return { apiMediator: slot, options: { startDate: start } } as unknown as IActionContext;
}

/**
 * Read the first DataEntity member of a Payload.
 * @param payload - Built Payload block.
 * @returns First DataEntity member.
 */
function firstEntity(payload: VarsMap): Record<string, unknown> {
  const de = payload.DataEntity as Record<string, unknown>[];
  return de[0];
}

/**
 * Read the `Prtflio.Id` block of a portfolio DataEntity member.
 * @param entity - Portfolio DataEntity member.
 * @returns PortfolioIdentifier block.
 */
function prtflioId(entity: Record<string, unknown>): Record<string, unknown> {
  const prtflio = entity.Prtflio as Record<string, unknown>;
  return prtflio.Id as Record<string, unknown>;
}

/**
 * Bundle a response body into the extract-accounts args.
 * @param body - Synthetic accounts response body.
 * @returns Extract-accounts args bundle.
 */
function accountsArgs(body: ApiBody): IExtractAccountsArgs {
  return { body, sessionContext: {} };
}

/**
 * Build a synthetic BaNCS accounts response with the account nested under
 * `DataEntity[].Account` plus a CURRENT balance entry.
 * @param balance - CURRENT balance magnitude (string, as BaNCS emits).
 * @returns MessageEnvelope-shaped accounts body.
 */
function accountsBody(balance: string): ApiBody {
  const accountId = { Id: { Id: 'fakeacct00001' }, iorId: 'fakeIor' };
  const balList = [{ CurrAmt: { Amt: { Value: balance } }, BalType: { CDE: 'CURRENT' } }];
  const account = { AccountId: accountId, BalanceList: balList };
  return { Payload: { DataEntity: [{ Account: account }] } };
}

describe('YahavShape envelope', () => {
  it('portfolioRefs reads the primed session-context', () => {
    const ctx = ctxWithBancs();
    const refs = portfolioRefs(ctx);
    expect(refs.iorId).toBe('fakePior');
    expect(refs.id).toBe('fakeport0001');
  });

  it('buildEnvelope carries the static fields + captured SecToken + payload', () => {
    const ctx = ctxWithBancs();
    const env = buildEnvelope(ctx, { probe: 1 });
    expect(env.AppVer).toBe(APP_VER);
    expect(env.SessionId).toBe('sessionId');
    expect(env.Payload).toEqual({ probe: 1 });
    const sec = env.SecToken as Record<string, unknown>;
    const tokens = sec.Token as Record<string, unknown>[];
    expect(tokens[0].TokenId).toBe('t-1');
  });

  it('buildEnvelope threads the captured AppVer through both ClientApp nodes', () => {
    const ctx = ctxWithBancs({ bancsAppVer: 'captured.build.FP99' });
    const env = buildEnvelope(ctx, {});
    expect(env.AppVer).toBe('captured.build.FP99');
    const clientApp = env.ClientApp as Record<string, unknown>;
    expect(clientApp.ApVer).toBe('captured.build.FP99');
    const comptLst = clientApp.ComptLst as Record<string, unknown>;
    const list = comptLst.AppCompLst as Record<string, unknown>[];
    expect(list[0].AppCompVer).toBe('captured.build.FP99');
  });

  it('buildEnvelope emits an empty SecToken.Token when the capture is absent', () => {
    const ctx = ctxWithBancs({ bancsSecToken: undefined });
    const env = buildEnvelope(ctx, {});
    const sec = env.SecToken as Record<string, unknown>;
    expect(sec.Token).toEqual([]);
  });

  it('buildEnvelope emits an empty SecToken.Token on a malformed capture', () => {
    const ctx = ctxWithBancs({ bancsSecToken: 'not-json' });
    const env = buildEnvelope(ctx, {});
    const sec = env.SecToken as Record<string, unknown>;
    expect(sec.Token).toEqual([]);
  });

  it('portfolioRefs yields empty refs when the mediator is absent', () => {
    const ctx = { options: {} } as unknown as IActionContext;
    const refs = portfolioRefs(ctx);
    expect(refs.iorId).toBe('');
  });

  it('csrfHeaders returns the captured CSRF request header', () => {
    const ctx = ctxWithBancs({ bancsCsrfName: 'csrfTkn', bancsCsrfValue: 'abc123' });
    const headers = csrfHeaders(ctx);
    expect(headers).toEqual({ csrfTkn: 'abc123' });
  });

  it('csrfHeaders returns an empty map when unprimed', () => {
    const ctx = ctxWithBancs();
    const headers = csrfHeaders(ctx);
    expect(headers).toEqual({});
  });

  it('csrfHeaders falls back to candidate names when only the value is known', () => {
    const ctx = ctxWithBancs({ bancsCsrfName: '', bancsCsrfValue: 'abc123' });
    const headers = csrfHeaders(ctx);
    expect(headers.csrfTkn).toBe('abc123');
    expect(headers['X-CSRF-Token']).toBe('abc123');
  });
});

describe('YahavShape payloads', () => {
  it('accountsPayload carries the portfolio refs + DDA/ILS filters, no Category', () => {
    const ctx = ctxWithBancs();
    const payload = accountsPayload(ctx);
    const entity = firstEntity(payload);
    const id = prtflioId(entity);
    expect(id.iorId).toBe('fakePior');
    expect(id.Id).toBe('fakeport0001');
    expect(payload.Category).toBeUndefined();
    expect(payload.Filters).toBeDefined();
  });

  it('balancePayload declares the portfolioBalance category and no Filters', () => {
    const ctx = ctxWithBancs();
    const payload = balancePayload(ctx);
    expect(payload.Category).toEqual(['portfolioBalance']);
    expect(payload.Filters).toBeUndefined();
  });

  it('txnsPayload keys the account id/iorId + CURRENT_ACCOUNT + OrigDt window', () => {
    const ctx = ctxWithBancs();
    const payload = txnsPayload(ACCT, CHUNK, ctx);
    const accountId = firstEntity(payload).AccountId as Record<string, unknown>;
    const idBlock = accountId.Id as Record<string, unknown>;
    expect(idBlock.Id).toBe('fakeacct00001');
    expect(accountId.iorId).toBe('fakeIor');
    expect(payload.Category).toEqual(['CURRENT_ACCOUNT']);
  });

  it('txnsPayload lower-bounds OrigDt at the chunk start', () => {
    const ctx = ctxWithBancs();
    const payload = txnsPayload(ACCT, CHUNK, ctx);
    const andFilter = (payload.Filters as Record<string, unknown>[])[0];
    const bounds = andFilter.Filters as Record<string, unknown>[];
    const start = bounds[0].OrigDt as Record<string, number>;
    expect(start).toEqual({ Ver: 'Date_1.0.0', Day: 25, Month: 6, Year: 2026 });
  });
});

describe('YahavShape account extraction', () => {
  it('extractYahavAccounts reads id + iorId + CURRENT balance', () => {
    const body = accountsBody('150.0');
    const args = accountsArgs(body);
    const accounts = extractYahavAccounts(args);
    expect(accounts).toEqual([{ id: 'fakeacct00001', iorId: 'fakeIor', balance: 150 }]);
  });

  it('extractYahavAccounts returns an empty list when DataEntity is absent', () => {
    const args = accountsArgs({});
    const accounts = extractYahavAccounts(args);
    expect(accounts).toEqual([]);
  });

  it('extractYahavAccounts defaults the balance to 0 when no CURRENT entry', () => {
    const account = { AccountId: { Id: { Id: 'x' }, iorId: 'y' }, BalanceList: [] };
    const args = accountsArgs({ Payload: { DataEntity: [{ Account: account }] } });
    const accounts = extractYahavAccounts(args);
    expect(accounts).toEqual([{ id: 'x', iorId: 'y', balance: 0 }]);
  });

  it('extractYahavAccounts drops a member with no AccountId', () => {
    const args = accountsArgs({ Payload: { DataEntity: [{ Account: {} }] } });
    const accounts = extractYahavAccounts(args);
    expect(accounts).toEqual([]);
  });

  it('extractYahavAccounts drops a member missing the iorId', () => {
    const account = { AccountId: { Id: { Id: 'x' } } };
    const args = accountsArgs({ Payload: { DataEntity: [{ Account: account }] } });
    const accounts = extractYahavAccounts(args);
    expect(accounts).toEqual([]);
  });
});

describe('YahavShape transactions', () => {
  it('txnsExtractPage signs + flattens the BaNCS rows to bancs* scalars', () => {
    const record = {
      OrigDt: { Day: 8, Month: 3, Year: 2026 },
      TotalCurAmt: { Amt: { Value: '250' } },
      TxnType: { OthrSubTyp: 'InPymntOrd' },
      TxnId: { TxnIds: { TRANSACTIONID: 'FAKE-1' } },
      Memo: 'FAKE MEMO',
    };
    const body = { Payload: { DataEntity: [record] } };
    const ctx = ctxWithBancs(undefined, new Date());
    const page = txnsExtractPage({ body, cursor: false, acct: ACCT, ctx });
    const row = page.items[0] as Record<string, unknown>;
    expect(row.bancsAmount).toBe(250);
    expect(page.nextCursor).toBe(false);
  });

  it('txnsExtractPage yields an empty page when no BaNCS rows are present', () => {
    const ctx = ctxWithBancs(undefined, new Date());
    const page = txnsExtractPage({ body: {}, cursor: false, acct: ACCT, ctx });
    expect(page.items).toEqual([]);
  });

  it('txnsExtractPage advances the cursor across multiple month chunks', () => {
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    const ctx = ctxWithBancs(undefined, start);
    const page = txnsExtractPage({ body: {}, cursor: false, acct: ACCT, ctx });
    expect(page.nextCursor).toBe(1);
  });

  it('txnsVars builds a CURRENT_ACCOUNT payload at a numeric cursor', () => {
    const ctx = ctxWithBancs();
    const vars = YAHAV_SHAPE.transactions.buildVars(ACCT, 0, ctx);
    const payload = vars.Payload as Record<string, unknown>;
    expect(payload.Category).toEqual(['CURRENT_ACCOUNT']);
  });

  it('txnsExtractPage falls back to one chunk for a future startDate', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const ctx = ctxWithBancs(undefined, future);
    const page = txnsExtractPage({ body: {}, cursor: false, acct: ACCT, ctx });
    expect(page.nextCursor).toBe(false);
  });

  it('txnsExtractPage advances from a numeric cursor', () => {
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    const ctx = ctxWithBancs(undefined, start);
    const page = txnsExtractPage({ body: {}, cursor: 1, acct: ACCT, ctx });
    expect(page.nextCursor).toBe(2);
  });
});

/**
 * Invoke a step `urlTag` (always a function for Yahav) to its URL string.
 * @param tag - The step's urlTag.
 * @param args - Args to pass the tag function.
 * @returns The resolved URL string.
 */
function tagUrl(tag: unknown, args: readonly unknown[]): string {
  const fn = tag as (...a: readonly unknown[]) => unknown;
  const url = fn(...args);
  return String(url);
}

describe('YAHAV_SHAPE step callables', () => {
  it('customer step builds the accounts envelope + targets /account', () => {
    const ctx = ctxWithBancs();
    const vars = YAHAV_SHAPE.customer.buildVars(ctx);
    const url = tagUrl(YAHAV_SHAPE.customer.urlTag, [ctx]);
    expect(vars.SessionId).toBe('sessionId');
    expect(url).toContain('/BaNCSDigitalApp/account');
  });

  it('balance step builds the portfolioBalance envelope + extracts CURRENT', () => {
    const ctx = ctxWithBancs();
    const vars = YAHAV_SHAPE.balance.buildVars(ACCT, ctx);
    const payload = vars.Payload as Record<string, unknown>;
    expect(payload.Category).toEqual(['portfolioBalance']);
    const body = accountsBody('321.5');
    const balance = YAHAV_SHAPE.balance.extract(body);
    expect(balance).toBe(321.5);
  });

  it('balance step extracts 0 when no CURRENT balance is present', () => {
    const balance = YAHAV_SHAPE.balance.extract({});
    expect(balance).toBe(0);
  });

  it('transactions step builds the CURRENT_ACCOUNT envelope + targets /account', () => {
    const ctx = ctxWithBancs();
    const vars = YAHAV_SHAPE.transactions.buildVars(ACCT, false, ctx);
    const payload = vars.Payload as Record<string, unknown>;
    const url = tagUrl(YAHAV_SHAPE.transactions.urlTag, [ACCT, false, ctx]);
    expect(payload.Category).toEqual(['CURRENT_ACCOUNT']);
    expect(url).toContain('/BaNCSDigitalApp/account');
  });
});

describe('YAHAV_SHAPE wiring', () => {
  it('declares POST for the accounts, balance, and transactions steps', () => {
    expect(YAHAV_SHAPE.customer.method).toBe('POST');
    expect(YAHAV_SHAPE.balance.method).toBe('POST');
    expect(YAHAV_SHAPE.transactions.method).toBe('POST');
  });

  it('carries the YahavScrape step name + account-id accessor', () => {
    const number = YAHAV_SHAPE.accountNumberOf(ACCT);
    expect(YAHAV_SHAPE.stepName).toBe('YahavScrape');
    expect(number).toBe('fakeacct00001');
  });
});
