/**
 * BALANCE-RESOLVE — captured-pool seed (v6 single-account rescue).
 *
 * <p>Covers the path where a browser bank (e.g. Bank Leumi) folds the
 * balance into the transactions response and has no separately-fetchable
 * balance endpoint. The live BALANCE-RESOLVE re-fetch is quarantined, so
 * PRE seeds the balance from the already-captured network pool and the
 * extractor resolves it. Fake values only — no PII.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { BULK_KEY } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceFetchPlanner.js';
import { buildCapturedFromPool } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.Captured.js';
import {
  executeBalanceResolveAction,
  executeBalanceResolvePre,
} from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.js';
import { buildActionContext } from '../../../../../Scrapers/Pipeline/Phases/Base/ActionContextBuilder.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IAccountIdentity,
  IBalanceFetchTemplate,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeFailingApi, makeMediatorWithPool, makePool } from './BalancePoolHelpers.js';

/** Leumi-shaped UC_SO_27 body: balance folded in, no card record. */
const LEUMI_BODY = {
  HistoryTransactionsItems: [{ DateUTC: '2026-06-17', Amount: 150, Description: 'salary' }],
  TodayTransactionsItems: null,
  BalanceDisplay: 150,
};

/** A body with no resolvable balance field. */
const NO_BALANCE_BODY = { foo: 'bar', items: [] };

/** Single Leumi checking-account identity (fake ids). */
const SINGLE_IDENTITY: ReadonlyMap<string, IAccountIdentity> = new Map([
  ['ACCT-1', { cardDisplayId: 'ACCT-1', cardUniqueId: 'UID-1', bankAccountUniqueId: 'BA-1' }],
]);

const TEMPLATE: IBalanceFetchTemplate = {
  url: 'https://fake.bank/getBalance',
  method: 'POST',
  postBodyKey: 'bankAccountUniqueId',
  headers: { 'content-type': 'application/json' },
};

describe('BALANCE-RESOLVE captured-pool — buildCapturedFromPool', () => {
  it('keys the first balance-bearing body under BULK_KEY', () => {
    const pool = makePool([LEUMI_BODY]);
    const captured = buildCapturedFromPool(pool);
    expect(captured.size).toBe(1);
    const bulk = captured.get(BULK_KEY);
    expect(bulk).toBe(LEUMI_BODY);
  });

  it('skips bodies with no balance and picks the first that has one', () => {
    const pool = makePool([NO_BALANCE_BODY, LEUMI_BODY]);
    const captured = buildCapturedFromPool(pool);
    const bulk = captured.get(BULK_KEY);
    expect(bulk).toBe(LEUMI_BODY);
  });

  it('returns empty when no captured body carries a balance', () => {
    const pool = makePool([NO_BALANCE_BODY]);
    const captured = buildCapturedFromPool(pool);
    expect(captured.size).toBe(0);
  });

  it('returns empty for an empty pool', () => {
    const pool = makePool([]);
    const captured = buildCapturedFromPool(pool);
    expect(captured.size).toBe(0);
  });
});

describe('BALANCE-RESOLVE captured-pool — single-account rescue', () => {
  it('resolves balance from the captured pool when the live fetch is quarantined', async () => {
    const scrape = some({
      accounts: [{ accountNumber: 'ACCT-1', balance: 0, txns: [] }],
      accountIdentities: SINGLE_IDENTITY,
      balanceFetchTemplate: TEMPLATE,
    });
    const pool = makePool([LEUMI_BODY]);
    const mediator = makeMediatorWithPool(pool);
    const failingApi = makeFailingApi();
    const api = some(failingApi);
    const preCtx = makeMockContext({ scrape, api, mediator });
    const preResult = await executeBalanceResolvePre(preCtx);
    const isPrePassed = isOk(preResult);
    expect(isPrePassed).toBe(true);
    if (!isPrePassed) throw new ScraperError('PRE must succeed');
    const actionCtx = preResult.value as unknown as Parameters<
      typeof executeBalanceResolveAction
    >[0];
    const result = await executeBalanceResolveAction(actionCtx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (!isSuccess) throw new ScraperError('ACTION must succeed');
    const { balanceExtracted } = result.value;
    expect(balanceExtracted.has).toBe(true);
    if (!balanceExtracted.has) throw new ScraperError('balance must be extracted');
    const acct = balanceExtracted.value.get('ACCT-1');
    expect(acct).toBe(150);
  });

  it('does NOT seed the captured pool for multi-account banks', async () => {
    const identities: ReadonlyMap<string, IAccountIdentity> = new Map([
      ['ACCT-1', { cardDisplayId: 'ACCT-1', cardUniqueId: 'UID-1', bankAccountUniqueId: 'BA-1' }],
      ['ACCT-2', { cardDisplayId: 'ACCT-2', cardUniqueId: 'UID-2', bankAccountUniqueId: 'BA-2' }],
    ]);
    const scrape = some({
      accounts: [],
      accountIdentities: identities,
      balanceFetchTemplate: TEMPLATE,
    });
    const pool = makePool([LEUMI_BODY]);
    const mediator = makeMediatorWithPool(pool);
    const failingApi = makeFailingApi();
    const api = some(failingApi);
    const preCtx = makeMockContext({ scrape, api, mediator });
    const preResult = await executeBalanceResolvePre(preCtx);
    if (!isOk(preResult)) throw new ScraperError('PRE must succeed');
    const seeded = preResult.value.balanceResponsesByBankAccount;
    const seededSize = seeded.has ? seeded.value.size : -1;
    expect(seededSize).toBe(0);
  });
});

describe('BALANCE-RESOLVE sealed action context — identities carried through the seal', () => {
  it('resolves balance after buildActionContext strips scrape', async () => {
    const scrape = some({
      accounts: [{ accountNumber: 'ACCT-1', balance: 0, txns: [] }],
      accountIdentities: SINGLE_IDENTITY,
      balanceFetchTemplate: TEMPLATE,
    });
    const pool = makePool([LEUMI_BODY]);
    const mediator = makeMediatorWithPool(pool);
    const failingApi = makeFailingApi();
    const api = some(failingApi);
    const preCtx = makeMockContext({ scrape, api, mediator });
    const preResult = await executeBalanceResolvePre(preCtx);
    if (!isOk(preResult)) throw new ScraperError('PRE must succeed');
    const sealed = buildActionContext(preResult.value);
    // The real seal drops `scrape` — the exact reason ACTION cannot read
    // identities from it; they must arrive via the carried balance slot.
    expect((sealed as { readonly scrape?: unknown }).scrape).toBeUndefined();
    expect(sealed.balanceAccountIdentities.has).toBe(true);
    const result = await executeBalanceResolveAction(sealed);
    if (!isOk(result)) throw new ScraperError('ACTION must succeed');
    const extracted = result.value.balanceExtracted;
    const got = extracted.has ? extracted.value.get('ACCT-1') : false;
    expect(got).toBe(150);
  });
});
