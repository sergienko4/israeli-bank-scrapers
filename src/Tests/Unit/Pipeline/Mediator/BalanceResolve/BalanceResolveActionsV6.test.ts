/**
 * BALANCE-RESOLVE actions — v6 contract (live fetch + extract).
 *
 * <p>Per debugging-guidlines.md §1 "failing test BEFORE fixing":
 * this file is created BEFORE PART E rewrites the actions. Tests
 * turn GREEN once the v6 contract is implemented.
 *
 * <p>v6 contract under test (per spec.txt §0):
 *   - .pre  reads scrape.accountIdentities + balanceFetchTemplate,
 *           emits balanceFetchPlan (dedupe by bankAccountUniqueId)
 *   - .action loops the plan, calls api.fetchPost / fetchGet per
 *           entry, collects balanceResponsesByBankAccount, then
 *           extracts per-card balance via runBalanceExtractor and
 *           emits balanceExtracted
 *   - .pre fails closed (Procedure fail) only on absent accountIdentities;
 *           an absent balanceFetchTemplate is a soft no-op (succeed with an
 *           empty plan) because card flows (Beinleumi/Max/VisaCal/Isracard)
 *           legitimately have no balance-bearing endpoint. The universal-miss
 *           POST gate still catches a real failure (identities resolved but
 *           every live balance fetch missed).
 *   - .action quarantines per-entry fetch failures (single failure
 *           does NOT abort the phase)
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeBalanceResolveAction,
  executeBalanceResolveFinal,
  executeBalanceResolvePost,
  executeBalanceResolvePre,
} from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IAccountIdentity,
  IApiFetchContext,
  IBalanceFetchTemplate,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  fail,
  isOk,
  type Procedure,
  succeed,
} from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/**
 * Build a fake IApiFetchContext that returns scripted responses per
 * URL + body. No async/await — returns Promise.resolve directly.
 *
 * @param scripts - Map of (url+'#'+body) → response procedure
 * @returns Fake api context
 */
function makeFakeApi(scripts: ReadonlyMap<string, Procedure<unknown>>): IApiFetchContext {
  /**
   * Scripted POST fetch — looks up url + body key, returns failure
   * when no script matches.
   *
   * @param url - URL.
   * @param body - JSON-encoded body.
   * @returns Scripted procedure.
   */
  const fetchPost = (url: string, body: Record<string, unknown>): Promise<Procedure<unknown>> => {
    const key = `${url}#${JSON.stringify(body)}`;
    const scripted = scripts.get(key) ?? fail(ScraperErrorTypes.Generic, 'no script');
    return Promise.resolve(scripted);
  };
  /**
   * Scripted GET fetch — looks up by url only.
   *
   * @param url - URL.
   * @returns Scripted procedure.
   */
  const fetchGet = (url: string): Promise<Procedure<unknown>> => {
    const key = `${url}#`;
    const scripted = scripts.get(key) ?? fail(ScraperErrorTypes.Generic, 'no script');
    return Promise.resolve(scripted);
  };
  return {
    fetchPost,
    fetchGet,
    transactionsUrl: false,
    balanceUrl: false,
  } as IApiFetchContext;
}

const FAKE_TEMPLATE_POST: IBalanceFetchTemplate = {
  url: 'https://fake.bank/getBalance',
  method: 'POST',
  postBodyKey: 'bankAccountUniqueId',
  headers: { 'content-type': 'application/json' },
};

const FAKE_IDENTITIES_VISACAL_SHAPE: ReadonlyMap<string, IAccountIdentity> = new Map([
  ['CARD-A', { cardDisplayId: 'CARD-A', cardUniqueId: 'UID-A', bankAccountUniqueId: 'BA-1' }],
  ['CARD-B', { cardDisplayId: 'CARD-B', cardUniqueId: 'UID-B', bankAccountUniqueId: 'BA-1' }],
  ['CARD-C', { cardDisplayId: 'CARD-C', cardUniqueId: 'UID-C', bankAccountUniqueId: 'BA-2' }],
]);

const BODY_FOR_BA1 = {
  result: {
    bigNumbers: [
      {
        cards: [
          {
            cardUniqueId: 'UID-A',
            nextDebit: { totalDebits: [{ currencyCode: 3, totalDebit: 100 }] },
          },
          {
            cardUniqueId: 'UID-B',
            nextDebit: { totalDebits: [{ currencyCode: 3, totalDebit: 200 }] },
          },
        ],
      },
    ],
  },
};

const BODY_FOR_BA2 = {
  result: {
    bigNumbers: [
      {
        cards: [
          {
            cardUniqueId: 'UID-C',
            nextDebit: { totalDebits: [{ currencyCode: 3, totalDebit: 300 }] },
          },
        ],
      },
    ],
  },
};

const SCRIPT_KEY_BA1 = `${FAKE_TEMPLATE_POST.url}#${JSON.stringify({ bankAccountUniqueId: 'BA-1' })}`;
const SCRIPT_KEY_BA2 = `${FAKE_TEMPLATE_POST.url}#${JSON.stringify({ bankAccountUniqueId: 'BA-2' })}`;

describe('BALANCE-RESOLVE v6 — pre/action contract', () => {
  it('PRE: emits balanceFetchPlan with one entry per unique bankAccountUniqueId', async () => {
    const scrape = some({
      accounts: [],
      accountIdentities: FAKE_IDENTITIES_VISACAL_SHAPE,
      balanceFetchTemplate: FAKE_TEMPLATE_POST,
    });
    const ctx = makeMockContext({ scrape });
    const result = await executeBalanceResolvePre(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess && result.value.balanceFetchPlan.has) {
      const plan = result.value.balanceFetchPlan.value;
      expect(plan.length).toBe(2);
      const ids = [...plan]
        .map((e): string => e.bankAccountUniqueId)
        .sort((a, b): number => a.localeCompare(b));
      expect(ids).toEqual(['BA-1', 'BA-2']);
    } else if (isSuccess) {
      throw new ScraperError('balanceFetchPlan must be present');
    }
  });

  it('PRE: default-deny when accountIdentities absent → Procedure fail', async () => {
    const scrape = some({ accounts: [], balanceFetchTemplate: FAKE_TEMPLATE_POST });
    const ctx = makeMockContext({ scrape });
    const result = await executeBalanceResolvePre(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('PRE: absent balanceFetchTemplate → soft no-op (succeed, empty plan)', async () => {
    const scrape = some({
      accounts: [],
      accountIdentities: FAKE_IDENTITIES_VISACAL_SHAPE,
    });
    const ctx = makeMockContext({ scrape });
    const result = await executeBalanceResolvePre(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (!isSuccess) throw new ScraperError('PRE must succeed');
    expect(result.value.balanceFetchPlan.has).toBe(true);
    if (result.value.balanceFetchPlan.has) {
      expect(result.value.balanceFetchPlan.value.length).toBe(0);
    }
  });

  it('ACTION: issues one fetchPost per plan entry; extracts per-card balance', async () => {
    const scripts = new Map<string, Procedure<unknown>>([
      [SCRIPT_KEY_BA1, succeed(BODY_FOR_BA1)],
      [SCRIPT_KEY_BA2, succeed(BODY_FOR_BA2)],
    ]);
    const scrape = some({
      accounts: [
        { accountNumber: 'CARD-A', balance: 0, txns: [] },
        { accountNumber: 'CARD-B', balance: 0, txns: [] },
        { accountNumber: 'CARD-C', balance: 0, txns: [] },
      ],
      accountIdentities: FAKE_IDENTITIES_VISACAL_SHAPE,
      balanceFetchTemplate: FAKE_TEMPLATE_POST,
    });
    const fakeApi = makeFakeApi(scripts);
    const api = some(fakeApi);
    const preCtx = makeMockContext({ scrape, api });
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
    if (isSuccess && result.value.balanceExtracted.has) {
      const out = result.value.balanceExtracted.value;
      const cardA = out.get('CARD-A');
      const cardB = out.get('CARD-B');
      const cardC = out.get('CARD-C');
      expect(cardA).toBe(100);
      expect(cardB).toBe(200);
      expect(cardC).toBe(300);
    }
  });

  it('ACTION: single fetch failure is quarantined — other cards still resolved', async () => {
    const scripts = new Map<string, Procedure<unknown>>([
      [SCRIPT_KEY_BA1, fail(ScraperErrorTypes.Generic, 'network blip')],
      [SCRIPT_KEY_BA2, succeed(BODY_FOR_BA2)],
    ]);
    const scrape = some({
      accounts: [],
      accountIdentities: FAKE_IDENTITIES_VISACAL_SHAPE,
      balanceFetchTemplate: FAKE_TEMPLATE_POST,
    });
    const fakeApi = makeFakeApi(scripts);
    const api = some(fakeApi);
    const preCtx = makeMockContext({ scrape, api });
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
    if (isSuccess && result.value.balanceExtracted.has) {
      const out = result.value.balanceExtracted.value;
      const cardA = out.get('CARD-A');
      const cardB = out.get('CARD-B');
      const cardC = out.get('CARD-C');
      expect(cardA).toBe('MISS');
      expect(cardB).toBe('MISS');
      expect(cardC).toBe(300);
    }
  });
});

describe('BALANCE-RESOLVE v6 — post/final edge branches', () => {
  it('POST: balanceExtracted absent → zero-state validation', async () => {
    const ctx = makeMockContext({ balanceExtracted: none() });
    const result = await executeBalanceResolvePost(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess && result.value.balanceValidation.has) {
      expect(result.value.balanceValidation.value.totalAccounts).toBe(0);
    }
  });

  it('POST: universal-miss → Procedure fail', async () => {
    const extracted = new Map<string, number | 'MISS'>([
      ['CARD-A', 'MISS'],
      ['CARD-B', 'MISS'],
    ]);
    const ctx = makeMockContext({ balanceExtracted: some(extracted) });
    const result = await executeBalanceResolvePost(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('FINAL: balanceExtracted absent → empty resolution', async () => {
    const ctx = makeMockContext({ balanceExtracted: none() });
    const result = await executeBalanceResolveFinal(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess && result.value.balanceResolution.has) {
      expect(result.value.balanceResolution.value.size).toBe(0);
    }
  });

  it('FINAL: extracted contains MISS → collapses to 0', async () => {
    const extracted = new Map<string, number | 'MISS'>([
      ['CARD-MISS', 'MISS'],
      ['CARD-HIT', 250],
    ]);
    const ctx = makeMockContext({ balanceExtracted: some(extracted) });
    const result = await executeBalanceResolveFinal(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess && result.value.balanceResolution.has) {
      const map = result.value.balanceResolution.value;
      const missBalance = map.get('CARD-MISS');
      const hitBalance = map.get('CARD-HIT');
      expect(missBalance).toBe(0);
      expect(hitBalance).toBe(250);
    }
  });
});
