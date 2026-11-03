/**
 * Yahav native scrape shape: the BaNCS login, profile and
 * portfolio bootstrap; the current-account list; the account match the
 * balance and transaction reads rely on; the month-chunked transaction walk;
 * and the shape wiring. Every id is fabricated, so the suite carries no PII.
 */

import { NATIVE_EMPTY_SECTOKEN } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavNativeEnvelopeStatic.js';
import { yahavAccountsPayload } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavNativePayloads.js';
import { yahavBalancePayload } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavNativePayloadsAccount.js';
import { YAHAV_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShape.js';
import { YAHAV_BOOTSTRAP } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShapeBootstrap.js';
import type { IYahavAcct } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShapeHelpers.js';
import { YAHAV_RESPONSE_SESSION } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShapeSession.js';
import type {
  ApiBody,
  ApiDirectScrapeHeadersLike,
  IApiDirectScrapeBootstrapStep,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { assertPostObject } from '../../../../Helpers/AssertPostData.js';
import {
  accountIdOf,
  ACCT,
  bancsAnswer,
  PRIMED,
  SEC_TOKEN,
  txnRow,
  yahavCtx,
} from './YahavNativeFactory.js';

/** The portfolio the primed session names. */
const PORTFOLIO = { id: 'fake-portfolio', iorId: 'fake-portfolio-ior' };

/** Another account of the same customer. */
const OTHER: IYahavAcct = { id: 'fake-other', iorId: 'fake-other-ior', number: 'fake-other-no' };

/** The account as a list that names no account number would give it. */
const UNNUMBERED: IYahavAcct = { id: ACCT.id, iorId: ACCT.iorId };

/** BaNCS routes on the wire, as the app calls them. */
const PATHS = {
  login: '/BaNCSDigitalApp/login',
  customer: '/BaNCSDigitalApp/customer',
  portfolio: '/BaNCSDigitalApp/portfolio',
  account: '/BaNCSDigitalApp/account',
} as const;

/** The native origin every BaNCS call posts to. */
const ORIGIN = 'https://mobile.yahav.co.il';

/** The multiplexed BaNCS account route every scrape read posts to. */
const ACCOUNT_URL = `${ORIGIN}${PATHS.account}`;

/** The primed context every read builds from. */
const CTX = yahavCtx(PRIMED);

/**
 * The bootstrap steps, in dispatch order.
 * @returns Bootstrap steps.
 */
function steps(): readonly IApiDirectScrapeBootstrapStep[] {
  const declared = YAHAV_SHAPE.bootstrap ?? [];
  return [declared].flat();
}

/**
 * The bootstrap step with a given name.
 * @param name - Step name.
 * @returns The step.
 */
function stepNamed(name: string): IApiDirectScrapeBootstrapStep {
  const found = steps().find(step => step.name === name);
  if (found === undefined) throw new TypeError(`no bootstrap step ${name}`);
  return found;
}

/**
 * Headers a step declares, for a context.
 * @param headers - Declared headers.
 * @param ctx - Action context.
 * @returns Header map.
 */
function headersOf(headers: ApiDirectScrapeHeadersLike = {}, ctx = CTX): object {
  if (typeof headers === 'function') return headers(ctx, {});
  return headers;
}

/**
 * Run a bootstrap step's patch over an answer.
 * @param name - Step name.
 * @param entities - Answer entities.
 * @returns Patch outcome.
 */
function patchOf(name: string, entities: readonly object[]): object {
  const body = bancsAnswer(entities);
  return stepNamed(name).extractPatch({ body, ctx: CTX });
}

/**
 * A portfolio relationship entity.
 * @param id - Portfolio id.
 * @param isDefault - Whether it is the customer's default portfolio.
 * @returns Relationship entity.
 */
function portfolioEntity(id: string, isDefault?: boolean): object {
  const ref = { Id: { Id: id, iorId: `${id}-ior` } };
  return { Ver: 'CustomerPortfolioRelationship_1.0.0', DefPortfolioInd: isDefault, Prtflio: ref };
}

/**
 * An accounts-list entity.
 * @param acct - Account it names.
 * @param kind - Account type and currency codes.
 * @returns Accounts-list entity.
 */
function accountEntity(acct: IYahavAcct, kind = { type: 'DDA', ccy: 'ILS' }): object {
  const shape = { Type: { CDE: kind.type }, Currency: { Code: { CDE: kind.ccy } } };
  return { Account: { ...shape, AccountId: accountIdOf(acct) } };
}

/**
 * A balance answer for one account.
 * @param acct - Account the balance belongs to.
 * @param value - CURRENT amount value.
 * @returns Balance answer body.
 */
function balanceAnswer(acct: IYahavAcct, value: unknown): ApiBody {
  const available = { BalType: { CDE: 'AVAILABLE' }, CurrAmt: { Amt: { Value: '1' } } };
  const current = { BalType: { CDE: 'CURRENT' }, CurrAmt: { Amt: { Value: value } } };
  const entity = { AccountId: accountIdOf(acct), BalanceList: [available, current] };
  return bancsAnswer([entity]);
}

/**
 * The transaction walk's context from a start date.
 * @param start - Scrape-window start.
 * @returns Action context.
 */
function walkCtx(start: Date): IActionContext {
  return yahavCtx(PRIMED, start);
}

/**
 * A date some months before now.
 * @param months - How many months back.
 * @returns The date.
 */
function monthsAgo(months: number): Date {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

describe('Yahav native bootstrap', () => {
  it('logs in, then reads the profile and the portfolio', () => {
    const declared = steps().map(step => [step.name, step.urlTag, step.method]);
    const login = ['login', `${ORIGIN}${PATHS.login}`, 'POST'];
    const profile = ['profile', `${ORIGIN}${PATHS.customer}`, 'POST'];
    const portfolio = ['portfolio', `${ORIGIN}${PATHS.portfolio}`, 'POST'];
    expect(declared).toEqual([login, profile, portfolio]);
  });

  it('logs in with the empty token, no CSRF token and empty session ids', () => {
    const login = stepNamed('login');
    const vars = login.buildVars(CTX);
    expect(vars).toMatchObject({ SecToken: NATIVE_EMPTY_SECTOKEN });
    expect(vars).not.toHaveProperty('csrfTkn');
    const headers = headersOf(login.extraHeaders);
    const ids = { JESESSIONID: '', 'X-XSRF-TOKEN': '', 'mag-identifier': PRIMED.mag };
    expect(headers).toMatchObject({ ...ids, request_path: PATHS.login });
  });

  it('reads with the session token, CSRF token and session ids', () => {
    const profile = stepNamed('profile');
    const vars = profile.buildVars(CTX);
    expect(vars).toMatchObject({ SecToken: SEC_TOKEN, csrfTkn: PRIMED.csrf });
    const headers = headersOf(profile.extraHeaders);
    const ids = { JESESSIONID: PRIMED.session, 'X-XSRF-TOKEN': PRIMED.xsrf };
    expect(headers).toMatchObject({ ...ids, request_path: PATHS.customer });
  });

  it('reads with the empty token before the session holds one', () => {
    const unprimed = yahavCtx({});
    const vars = stepNamed('portfolio').buildVars(unprimed);
    expect(vars).toMatchObject({ SecToken: NATIVE_EMPTY_SECTOKEN, csrfTkn: '' });
  });

  it('adds nothing to the session on the login', () => {
    const patch = patchOf('login', []);
    expect(patch).toEqual({ success: true, value: {} });
  });

  it('accepts a profile naming the customer user', () => {
    const user = { Ver: 'CustomerUser_1.0.0' };
    const patch = patchOf('profile', [user]);
    expect(patch).toEqual({ success: true, value: {} });
  });

  it('fails a profile without the customer user', () => {
    const patch = patchOf('profile', [{ Ver: 'Other_1.0.0' }]);
    expect(patch).toMatchObject({ success: false, errorMessage: 'profile customer missing' });
  });

  it('keeps the default portfolio', () => {
    const entities = [portfolioEntity('fake-a'), portfolioEntity('fake-b', true)];
    const value = { portfolioId: 'fake-b', portfolioIorId: 'fake-b-ior' };
    const patch = patchOf('portfolio', entities);
    expect(patch).toEqual({ success: true, value });
  });

  it('falls back to the first portfolio when none is the default', () => {
    const entities = [portfolioEntity('fake-a'), portfolioEntity('fake-b', false)];
    const value = { portfolioId: 'fake-a', portfolioIorId: 'fake-a-ior' };
    const patch = patchOf('portfolio', entities);
    expect(patch).toEqual({ success: true, value });
  });

  it.each([
    ['no portfolio', []],
    ['a portfolio without ids', [{ Prtflio: {} }]],
    ['a portfolio id with a line break', [portfolioEntity('fake\nid')]],
  ])('fails on %s', (_label, entities) => {
    const patch = patchOf('portfolio', entities);
    expect(patch).toMatchObject({ success: false, errorMessage: 'portfolio reference missing' });
  });
});

describe('Yahav native accounts', () => {
  it('asks for the primed portfolio accounts with the session state', () => {
    const vars = YAHAV_SHAPE.customer.buildVars(CTX);
    const payload = yahavAccountsPayload(PORTFOLIO);
    expect(vars).toMatchObject({ SecToken: SEC_TOKEN, csrfTkn: PRIMED.csrf, Payload: payload });
  });

  it('keeps the current ILS accounts with their ids and number', () => {
    const fx = accountEntity(OTHER, { type: 'DDA', ccy: 'USD' });
    const body = bancsAnswer([accountEntity(ACCT), fx, { Other: true }]);
    const args = { body, sessionContext: PRIMED };
    const accounts = YAHAV_SHAPE.customer.extractAccounts(args);
    expect(accounts).toEqual([ACCT]);
    expect(YAHAV_SHAPE.customer.countDiscovered?.(args)).toBe(2);
  });

  it('keeps an account the bank names without a number', () => {
    const bare = { Type: { CDE: 'DDA' }, Currency: { Code: { CDE: 'ILS' } } };
    const accountId = { Id: { Id: ACCT.id }, iorId: ACCT.iorId };
    const body = bancsAnswer([{ Account: { ...bare, AccountId: accountId } }]);
    const accounts = YAHAV_SHAPE.customer.extractAccounts({ body, sessionContext: PRIMED });
    expect(accounts).toEqual([{ id: ACCT.id, iorId: ACCT.iorId }]);
  });

  it('treats an empty account number as none', () => {
    const body = bancsAnswer([accountEntity({ ...ACCT, number: '' })]);
    const accounts = YAHAV_SHAPE.customer.extractAccounts({ body, sessionContext: PRIMED });
    expect(accounts).toEqual([{ id: ACCT.id, iorId: ACCT.iorId }]);
  });

  it('drops an account whose id carries a line break', () => {
    const broken = { ...ACCT, id: 'fake\naccount' };
    const body = bancsAnswer([accountEntity(broken)]);
    const accounts = YAHAV_SHAPE.customer.extractAccounts({ body, sessionContext: PRIMED });
    expect(accounts).toEqual([]);
  });
});

describe('Yahav native balance', () => {
  const balance = YAHAV_SHAPE.balance;

  it('asks for the account balance with the session state', () => {
    const vars = balance.buildVars(ACCT, CTX);
    const payload = yahavBalancePayload({ portfolio: PORTFOLIO, account: ACCT });
    expect(vars).toMatchObject({ SecToken: SEC_TOKEN, Payload: payload });
  });

  it.each([
    ['a text amount', '1234.50', 1234.5],
    ['a numeric amount', -12, -12],
  ])('reads the CURRENT figure from %s', (_label, value, expected) => {
    const body = balanceAnswer(ACCT, value);
    expect(balance.isAbsent?.(body, ACCT)).toBe(false);
    const amount = balance.extract(body, ACCT);
    expect(amount).toBe(expected);
  });

  it('matches the account when the bank rotates its IOR id', () => {
    const body = balanceAnswer({ ...ACCT, iorId: 'fake-rotated-ior' }, '7');
    expect(balance.isAbsent?.(body, ACCT)).toBe(false);
  });

  it.each([
    ['an account listed without a number', UNNUMBERED, balanceAnswer(ACCT, '7')],
    ['an empty number echoed back', ACCT, balanceAnswer({ ...ACCT, number: '' }, '7')],
  ])('matches the figure for %s', (_label, acct, body) => {
    expect(balance.isAbsent?.(body, acct)).toBe(false);
  });

  it.each([
    ['another account', balanceAnswer(OTHER, '7')],
    ['a conflicting account number', balanceAnswer({ ...ACCT, number: 'fake-x' }, '7')],
    ['a non-numeric amount', balanceAnswer(ACCT, '7 ILS')],
    ['no amount', balanceAnswer(ACCT, undefined)],
  ])('reports the figure absent for %s', (_label, body) => {
    expect(balance.isAbsent?.(body, ACCT)).toBe(true);
  });

  it('fails the scrape rather than inventing a balance when the read fails', () => {
    expect(balance.fallbackOnFail).toBeUndefined();
  });
});

describe('Yahav native transactions', () => {
  const txns = YAHAV_SHAPE.transactions;

  it('keeps only this account transaction rows, BaNCS-normalized', () => {
    const rotated = { ...ACCT, iorId: 'fake-rotated-ior' };
    const rows = [txnRow(ACCT, '-50.00'), txnRow(OTHER, '-20.00'), txnRow(rotated, '-5.00')];
    const body = bancsAnswer([...rows, { Ver: 'Other_1.0.0' }]);
    const page = txns.extractPage({ body, cursor: false, acct: ACCT, ctx: CTX });
    const dates = page.items.map(row => (row as Record<string, unknown>).bancsDate);
    expect(dates).toEqual(['2026-06-03', '2026-06-03']);
  });

  it('keeps the rows of an account listed without a number', () => {
    const body = bancsAnswer([txnRow(ACCT, '-50.00'), txnRow(OTHER, '-20.00')]);
    const page = txns.extractPage({ body, cursor: false, acct: UNNUMBERED, ctx: CTX });
    expect(page.items).toHaveLength(1);
  });

  it('asks for the current-account rows with the session state', () => {
    const vars = txns.buildVars(ACCT, false, CTX);
    assertPostObject(vars);
    expect(vars).toMatchObject({ SecToken: SEC_TOKEN, csrfTkn: PRIMED.csrf });
    expect(vars.Payload).toMatchObject({ Category: ['CURRENT_ACCOUNT'] });
  });

  it.each<[string, number | false, number]>([
    ['the first call', false, 1],
    ['a numeric cursor', 1, 2],
  ])('walks month by month from %s', (_label, cursor, next) => {
    const start = monthsAgo(3);
    const ctx = walkCtx(start);
    const page = txns.extractPage({ body: {}, cursor, acct: ACCT, ctx });
    expect(page.nextCursor).toBe(next);
  });

  it('ends after one chunk for a future start', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const page = txns.extractPage({ body: {}, cursor: false, acct: ACCT, ctx: walkCtx(future) });
    expect(page.nextCursor).toBe(false);
  });

  it('asks for the window end bank day when a future start leaves no chunks', () => {
    const base = walkCtx(new Date('2027-03-02T12:00:00.000Z'));
    const ctx = { ...base, windowEnd: some(new Date('2026-03-01T22:30:00.000Z')) };
    const vars = txns.buildVars(ACCT, 0, ctx);
    assertPostObject(vars);
    const payload = vars.Payload as { Filters: { Filters: { OrigDt: object }[] }[] };
    const from = payload.Filters[0].Filters[0].OrigDt;
    expect(from).toMatchObject({ Day: 2, Month: 3, Year: 2026 });
  });

  it('rejects an oversized range', () => {
    const ctx = walkCtx(new Date('1900-01-01T00:00:00.000Z'));
    const plan = txns.validatePlan?.(ctx);
    const errorMessage = 'Yahav: invalid or oversized month plan';
    expect(plan).toMatchObject({ success: false, errorMessage });
  });
});

describe('Yahav native shape wiring', () => {
  it('signs, rotates and bootstraps every call', () => {
    const digest = { header: 'BD_IDENT_KEY', hash: 'sha256-hex', encode: 'base64' };
    expect(YAHAV_SHAPE.bodyDigest).toMatchObject(digest);
    expect(YAHAV_SHAPE.responseSession).toBe(YAHAV_RESPONSE_SESSION);
    expect(YAHAV_SHAPE.bootstrap).toBe(YAHAV_BOOTSTRAP);
  });

  it('posts every scrape read to the account route with the read headers', () => {
    const { customer, balance, transactions } = YAHAV_SHAPE;
    const reads = [customer, balance, transactions];
    const routes = reads.map(read => [read.urlTag, read.method]);
    expect(routes).toEqual([
      [ACCOUNT_URL, 'POST'],
      [ACCOUNT_URL, 'POST'],
      [ACCOUNT_URL, 'POST'],
    ]);
    const headers = reads.map(read => headersOf(read.extraHeaders));
    const path = { request_path: PATHS.account, JESESSIONID: PRIMED.session };
    expect(headers).toEqual([headers[0], headers[0], headers[0]]);
    expect(headers[0]).toMatchObject(path);
  });

  it('numbers an account by its BaNCS id', () => {
    const number = YAHAV_SHAPE.accountNumberOf(ACCT);
    expect(number).toBe(ACCT.id);
  });
});
