/**
 * Leumi WCF response checks and loss guards use synthetic provider bodies.
 */

import { jest } from '@jest/globals';

import { LEUMI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShape.js';
import { leumiBrokerUrl } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShapeEnvelope.js';
import { GET_ACCOUNTS_MODULE } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShapeHelpers.js';
import { UC_SO_27_MODULE } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShapeUcSo27.js';
import {
  buildApiDirectScrapePhase,
  createApiDirectScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type {
  ApiBody,
  IApiDirectScrapeGuardSummary,
  ScrapeOperation,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeRouterBus } from '../../Phases/ApiDirectScrape/ApiDirectScrapeRouterBus.js';

const ACCOUNT = { AccountIndex: 0, MaskedNumber: '99-12345/88' };
const STATUS = { Status: true, SOStatusItem: null };
const START = new Date('2026-01-01T00:00:00Z');

/**
 * Wraps a synthetic WCF response.
 * @param inner - Synthetic inner response.
 * @returns Response envelope.
 */
function envelope(inner: object): ApiBody {
  return { ProcessRequestResult: 0, jsonResp: JSON.stringify(inner) };
}

/**
 * Runs the shape's configured operation check.
 * @param operation - Scrape operation.
 * @param body - Synthetic response.
 * @returns The check outcome, or undefined if not configured.
 */
function check(operation: ScrapeOperation, body: ApiBody): unknown {
  return LEUMI_SHAPE.checkBodyByOperation?.[operation]?.(body);
}

/**
 * Supplies a clean, PII-free scrape summary.
 * @param overrides - Signals to change for the case.
 * @returns Guard input.
 */
function summary(
  overrides: Partial<IApiDirectScrapeGuardSummary> = {},
): IApiDirectScrapeGuardSummary {
  return {
    accountCount: 1,
    totalTxns: 0,
    balanceDegraded: false,
    observedCaveats: [],
    ...overrides,
  };
}

describe('Leumi WCF operation checks', () => {
  const accounts = envelope({ AccountsItems: [ACCOUNT] });
  const balance = envelope({ SOStatus: STATUS, BalanceDisplay: 0 });
  const txns = envelope({ SOStatus: STATUS, HistoryTransactionsItems: [] });

  it.each([
    ['customer', accounts],
    ['balance', balance],
    ['txns', txns],
  ] as const)('accepts a valid %s response', (operation, body) => {
    const result = check(operation, body);
    expect(result).toEqual({ success: true, value: body });
  });

  it.each([
    ['missing result', { jsonResp: '{}' }],
    ['nonzero result', { ProcessRequestResult: 1, jsonResp: '{}' }],
    ['missing inner response', { ProcessRequestResult: 0 }],
    ['malformed inner response', { ProcessRequestResult: 0, jsonResp: '{secret:' }],
    ['non-object inner response', { ProcessRequestResult: 0, jsonResp: '[]' }],
  ])('refuses %s without exposing response content', (_name, body) => {
    const result = check('customer', body);
    expect(result).toMatchObject({ success: false });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret');
  });

  it.each([
    ['missing accounts', {}],
    ['empty accounts', { AccountsItems: [] }],
    ['missing index', { AccountsItems: [{ MaskedNumber: 'display' }] }],
    ['negative index', { AccountsItems: [{ ...ACCOUNT, AccountIndex: -1 }] }],
    ['fractional index', { AccountsItems: [{ ...ACCOUNT, AccountIndex: 0.5 }] }],
    ['missing display', { AccountsItems: [{ AccountIndex: 0 }] }],
    ['blank display', { AccountsItems: [{ ...ACCOUNT, MaskedNumber: '  ' }] }],
    ['invalid row', { AccountsItems: [null] }],
    ['duplicate index', { AccountsItems: [ACCOUNT, { ...ACCOUNT, MaskedNumber: 'other' }] }],
    ['duplicate display', { AccountsItems: [ACCOUNT, { ...ACCOUNT, AccountIndex: 1 }] }],
  ])('refuses customer %s', (_name, inner) => {
    const body = envelope(inner);
    const result = check('customer', body);
    expect(result).toMatchObject({ success: false });
  });

  it.each([
    ['missing status', { BalanceDisplay: 1 }],
    ['false status', { SOStatus: { Status: false }, BalanceDisplay: 1 }],
    ['non-boolean status', { SOStatus: { Status: 'true' }, BalanceDisplay: 1 }],
    ['missing balance', { SOStatus: STATUS }],
    ['null balance', { SOStatus: STATUS, BalanceDisplay: null }],
    ['string balance', { SOStatus: STATUS, BalanceDisplay: '1' }],
  ])('refuses balance %s', (_name, inner) => {
    const body = envelope(inner);
    const result = check('balance', body);
    expect(result).toMatchObject({ success: false });
  });

  it('refuses non-finite numeric balance', () => {
    const body = {
      ProcessRequestResult: 0,
      jsonResp: '{"SOStatus":{"Status":true},"BalanceDisplay":1e309}',
    };
    const result = check('balance', body);
    expect(result).toMatchObject({ success: false });
  });

  it.each([
    ['missing status', { HistoryTransactionsItems: [] }],
    ['false status', { SOStatus: { Status: false }, HistoryTransactionsItems: [] }],
    ['missing rows', { SOStatus: STATUS }],
    ['null rows', { SOStatus: STATUS, HistoryTransactionsItems: null }],
    ['invalid row', { SOStatus: STATUS, HistoryTransactionsItems: [null] }],
    ['missing amount', { SOStatus: STATUS, HistoryTransactionsItems: [{ DateUTC: '2026-01-01' }] }],
    [
      'invalid amount',
      { SOStatus: STATUS, HistoryTransactionsItems: [{ Amount: 'not-a-number' }] },
    ],
    ['blank amount', { SOStatus: STATUS, HistoryTransactionsItems: [{ Amount: ' ' }] }],
  ])('refuses transactions %s', (_name, inner) => {
    const body = envelope(inner);
    const result = check('txns', body);
    expect(result).toMatchObject({ success: false });
  });

  it('accepts a genuine zero transaction amount', () => {
    const body = envelope({ SOStatus: STATUS, HistoryTransactionsItems: [{ Amount: 0 }] });
    const result = check('txns', body);
    expect(result).toMatchObject({ success: true });
  });

  it('accepts a numeric original amount with the bank amount', () => {
    const body = envelope({
      SOStatus: STATUS,
      HistoryTransactionsItems: [{ Amount: '10', originalAmount: '12' }],
    });
    const result = check('txns', body);
    expect(result).toMatchObject({ success: true });
  });

  it('refuses a valid customer response in the balance operation', () => {
    const result = check('balance', accounts);
    expect(result).toMatchObject({ success: false });
  });
});

describe('Leumi result guard', () => {
  it.each(['declaredRowShortfall', 'extractionShortfall', 'mappingRejectedRows'] as const)(
    'refuses observed %s',
    caveat => {
      const input = summary({ observedCaveats: [caveat] });
      const result = LEUMI_SHAPE.resultGuard?.(input);
      expect(result).toMatchObject({ success: false });
    },
  );

  it('refuses missing evidence and a degraded balance', () => {
    const missing = summary({ observedCaveats: undefined });
    const degraded = summary({ balanceDegraded: true });
    const missingResult = LEUMI_SHAPE.resultGuard?.(missing);
    const degradedResult = LEUMI_SHAPE.resultGuard?.(degraded);
    expect(missingResult).toMatchObject({ success: false });
    expect(degradedResult).toMatchObject({ success: false });
  });

  it('accepts unavailable audits without claiming coverage', () => {
    const caveats = ['declaredRowAuditUnavailable', 'extractionAuditUnavailable'] as const;
    const input = summary({ observedCaveats: caveats });
    const result = LEUMI_SHAPE.resultGuard?.(input);
    expect(result).toMatchObject({ success: true });
  });
});

describe('Leumi WCF checks in the real scrape driver', () => {
  it('refuses duplicate account indices before requesting financial details', async () => {
    const accounts = envelope({
      AccountsItems: [ACCOUNT, { ...ACCOUNT, MaskedNumber: 'other-account' }],
    });
    const bus = makeRouterBus({ [leumiBrokerUrl(GET_ACCOUNTS_MODULE)]: [succeed(accounts)] });
    const ctx = {
      ...makeMockContext({ apiMediator: some(bus) }),
      executor: none(),
      windowEnd: none(),
    };
    const outcome = await createApiDirectScrapePhase(LEUMI_SHAPE)(ctx);
    expect(outcome).toMatchObject({
      success: false,
      errorMessage: 'Leumi customer WCF response failed validation',
    });
    expect(bus.apiPost).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid amount', { Amount: 'invalid' }],
    ['nested replacement for a missing amount', { Amount: null, aux: { amount: 77 } }],
    ['conflicting higher-priority amount', { Amount: 10, OperationAmount: 77 }],
    ['non-finite original amount', { Amount: 10, originalAmount: 'Infinity' }],
    ['nested original amount', { Amount: 10, aux: { originalAmount: 77 } }],
    ['nested direction changing the sign', { Amount: 10, aux: { direction: 'debit' } }],
    ['unrelated direction code changing the sign', { Amount: 10, eventActivityTypeCode: 2 }],
  ])('refuses %s in the transaction driver', async (_name, row) => {
    const accounts = envelope({ AccountsItems: [ACCOUNT] });
    const balance = envelope({ SOStatus: STATUS, BalanceDisplay: 7 });
    const page = envelope({
      SOStatus: STATUS,
      HistoryTransactionsItems: [{ DateUTC: '2026-02-01', ...row }],
    });
    const bus = makeRouterBus({
      [leumiBrokerUrl(GET_ACCOUNTS_MODULE)]: [succeed(accounts)],
      [leumiBrokerUrl(UC_SO_27_MODULE)]: [succeed(balance), succeed(page)],
    });
    const ctx = {
      ...makeMockContext({ apiMediator: some(bus) }),
      executor: none(),
      windowEnd: none(),
    };
    const outcome = await createApiDirectScrapePhase(LEUMI_SHAPE)(ctx);
    expect(outcome).toMatchObject({
      success: false,
      errorMessage: 'Leumi transactions WCF response failed validation',
    });
    expect(bus.apiPost).toHaveBeenCalledTimes(3);
  });

  it('refuses a customer response at balance before extracting the fallback zero', async () => {
    const accounts = envelope({ AccountsItems: [ACCOUNT] });
    const bus = makeRouterBus({
      [leumiBrokerUrl(GET_ACCOUNTS_MODULE)]: [succeed(accounts)],
      [leumiBrokerUrl(UC_SO_27_MODULE)]: [succeed(accounts)],
    });
    const extract = jest.fn(LEUMI_SHAPE.balance.extract);
    const shape = { ...LEUMI_SHAPE, balance: { ...LEUMI_SHAPE.balance, extract } };
    const ctx: IActionContext = {
      ...makeMockContext({ apiMediator: some(bus) }),
      executor: none(),
      windowEnd: none(),
    };
    const run = createApiDirectScrapePhase(shape);
    const outcome = await run(ctx);
    expect(outcome).toMatchObject({
      success: false,
      errorMessage: 'Leumi balance WCF response failed validation',
    });
    expect(extract).not.toHaveBeenCalled();
  });

  it('preserves a real zero balance and an empty unproven window', async () => {
    const accounts = envelope({ AccountsItems: [ACCOUNT] });
    const balance = envelope({ SOStatus: STATUS, BalanceDisplay: 0 });
    const page = envelope({ SOStatus: STATUS, HistoryTransactionsItems: [] });
    const bus = makeRouterBus({
      [leumiBrokerUrl(GET_ACCOUNTS_MODULE)]: [succeed(accounts)],
      [leumiBrokerUrl(UC_SO_27_MODULE)]: [succeed(balance), succeed(page)],
    });
    const base = makeMockContext({ apiMediator: some(bus) });
    const ctx = {
      ...base,
      options: { ...base.options, startDate: START },
      executor: none(),
      windowEnd: none(),
    };
    const run = createApiDirectScrapePhase(LEUMI_SHAPE);
    const action = await run(ctx);
    assertOk(action);
    assertHas(action.value.scrape);
    expect(action.value.scrape.value.accounts[0]).toMatchObject({
      balance: 0,
      txns: [],
      windowCoverage: { status: 'unproven' },
    });
    const phase = buildApiDirectScrapePhase(LEUMI_SHAPE);
    const outcome = await phase.post(ctx, { ...ctx, scrape: action.value.scrape });
    expect(outcome.success).toBe(true);
  });

  it('keeps mapped historical amounts, dates and identifiers', async () => {
    const accounts = envelope({ AccountsItems: [ACCOUNT] });
    const balance = envelope({ SOStatus: STATUS, BalanceDisplay: 7 });
    const rows = [
      { DateUTC: '2025-12-31', Description: 'older', Amount: 1, FITID: 'prior' },
      {
        DateUTC: '2026-02-01',
        Description: 'market',
        Amount: -10,
        FITID: 'unique',
        aux: { dealSumType: '0' },
      },
      { DateUTC: '2026-03-01', Description: 'bakery', Amount: 20, ReferenceNumberLong: 781 },
    ];
    const page = envelope({ SOStatus: STATUS, HistoryTransactionsItems: rows });
    const bus = makeRouterBus({
      [leumiBrokerUrl(GET_ACCOUNTS_MODULE)]: [succeed(accounts)],
      [leumiBrokerUrl(UC_SO_27_MODULE)]: [succeed(balance), succeed(page)],
    });
    const base = makeMockContext({ apiMediator: some(bus) });
    const ctx = {
      ...base,
      options: { ...base.options, startDate: START },
      executor: none(),
      windowEnd: none(),
    };
    const run = createApiDirectScrapePhase(LEUMI_SHAPE);
    const action = await run(ctx);
    assertOk(action);
    assertHas(action.value.scrape);
    const account = action.value.scrape.value.accounts[0];
    expect(account.balance).toBe(7);
    expect(account.txns).toMatchObject([
      { date: '2026-01-31T22:00:00.000Z', chargedAmount: -10, identifier: 'unique' },
      { date: '2026-02-28T22:00:00.000Z', chargedAmount: 20, identifier: 781 },
    ]);
    const phase = buildApiDirectScrapePhase(LEUMI_SHAPE);
    const outcome = await phase.post(ctx, { ...ctx, scrape: action.value.scrape });
    expect(outcome.success).toBe(true);
  });

  it('refuses mapping loss even when the backfill bound does not move', async () => {
    const rows = [
      { DateUTC: '2026-06-02', Description: 'market', Amount: 10, FITID: 'row-1' },
      { DateUTC: 'invalid-date', Description: 'bakery', Amount: 20, FITID: 'row-2' },
    ];
    const accounts = envelope({ AccountsItems: [ACCOUNT] });
    const balance = envelope({ SOStatus: STATUS, BalanceDisplay: 0 });
    const page = envelope({ SOStatus: STATUS, HistoryTransactionsItems: rows });
    const bus = makeRouterBus({
      [leumiBrokerUrl(GET_ACCOUNTS_MODULE)]: [succeed(accounts)],
      [leumiBrokerUrl(UC_SO_27_MODULE)]: [succeed(balance), succeed(page), succeed(page)],
    });
    const base = makeMockContext({ apiMediator: some(bus) });
    const ctx = {
      ...base,
      options: { ...base.options, startDate: START },
      executor: none(),
      windowEnd: none(),
    };
    const run = createApiDirectScrapePhase(LEUMI_SHAPE);
    const action = await run(ctx);
    assertOk(action);
    assertHas(action.value.scrape);
    expect(action.value.scrape.value.accounts[0].windowCoverage).toMatchObject({
      status: 'unproven',
      reason: 'boundDidNotMove',
    });
    expect(action.value.scrape.value.observedCaveats).toContain('mappingRejectedRows');
    const phase = buildApiDirectScrapePhase(LEUMI_SHAPE);
    const outcome = await phase.post(ctx, { ...ctx, scrape: action.value.scrape });
    expect(outcome).toMatchObject({ success: false });
  });
});
