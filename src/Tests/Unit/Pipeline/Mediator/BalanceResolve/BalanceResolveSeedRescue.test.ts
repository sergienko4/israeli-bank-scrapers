/**
 * BALANCE-RESOLVE — captured-seed rescue regression lock (FIBI/Beinleumi).
 *
 * <p>Reproduces the real FIBI/Beinleumi (Massad/OtsarHahayal/Pagi) balance
 * miss OFFLINE. Those banks fold the account balance into the dashboard
 * `accountSummary` response, which is captured into the CUMULATIVE network
 * pool (the mediator is created once at INIT, so the pool spans every phase)
 * BEFORE BALANCE-RESOLVE — but the SCRAPE.post snapshot carried on the scrape
 * slice ({@link IScrapeState.balanceResponseBodies}) was taken from a
 * transactions-only scrape and does NOT contain the balance. The mediator is
 * still present at BALANCE-RESOLVE.pre.
 *
 * <p>WITHOUT the rescue (carried snapshot preferred unconditionally) the
 * carried transactions-only bodies SHADOW the live cumulative pool → the
 * captured seed is empty → the live re-fetch hits a leverage facility (not a
 * balance) and misses → universal-miss hard-fail. That is the exact live
 * regression (`resolved=0 missed=1 total=1`). WITH the rescue (the carried
 * snapshot is honoured only when it actually carries a balance, else fall
 * back to the cumulative mediator pool) the folded `accountSummary` balance
 * resolves → resolved=1.
 *
 * <p>This is a TRUE regression lock: it drives the REAL production
 * PRE → seal ({@link buildActionContext}) → ACTION → POST chain and FAILS on
 * the pre-rescue carried-only seed. Fake values only — no PII.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeBalanceResolveAction,
  executeBalanceResolvePost,
  executeBalanceResolvePre,
} from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.js';
import { buildActionContext } from '../../../../../Scrapers/Pipeline/Phases/Base/ActionContextBuilder.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IAccountIdentity,
  IBalanceFetchTemplate,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, type Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeMediatorWithPool, makePerUrlApi, makePool } from './BalancePoolHelpers.js';

/**
 * FAKE FIBI/Beinleumi `accountSummary` — faithful shape + key order
 * (`other` shaarukh rows → `local` → `foreign`), shaarukh rows zero, the real
 * ILS balance under `currentBalances.local.totalAmount`. No PII.
 */
const ACCOUNT_SUMMARY = {
  currentBalances: {
    other: [{ totalAmount: 0 }, { totalAmount: 0 }],
    local: { totalAmount: 12345.67 },
    foreign: { totalAmount: 678.9 },
  },
};

/** Transactions-only body — what the SCRAPE.post snapshot carried (NO balance). */
const TXN_ONLY: readonly unknown[] = [{ transactions: [{ date: '2026-06-17', amount: -50 }] }];

/** Live re-fetch hits a leverage facility (not a balance) — modelled all-4xx. */
const LEVERAGED_TEMPLATE: IBalanceFetchTemplate = {
  url: 'https://al-online.fibi.co.il/rest/utils/leveragedAccount',
  method: 'GET',
};

/** The single bank-account id under test. */
const BA = 'BA-FIBI1';

/**
 * Build a one-account identity map.
 * @param ba - bankAccountUniqueId.
 * @returns Single-entry identity map keyed by the id.
 */
function oneIdentity(ba: string): ReadonlyMap<string, IAccountIdentity> {
  return new Map([[ba, { cardDisplayId: ba, cardUniqueId: `UID-${ba}`, bankAccountUniqueId: ba }]]);
}

/**
 * Build the PRE context — mediator PRESENT (cumulative pool), carried snapshot
 * transactions-only, live re-fetch all-4xx (the leverage facility misses).
 * @param poolBodies - Cumulative mediator-pool bodies.
 * @returns Mock pipeline context for the FIBI/Beinleumi rescue scenario.
 */
function makeCtx(poolBodies: readonly unknown[]): IPipelineContext {
  const accountIdentities = oneIdentity(BA);
  const scrape = some({
    accounts: [],
    accountIdentities,
    balanceFetchTemplate: LEVERAGED_TEMPLATE,
    balanceResponseBodies: TXN_ONLY,
  });
  const pool = makePool(poolBodies);
  const mediator = makeMediatorWithPool(pool);
  const emptySuccess = new Map<string, unknown>();
  const perUrlApi = makePerUrlApi(emptySuccess);
  const api = some(perUrlApi);
  const config = {
    urls: { base: 'https://al-online.fibi.co.il' },
    balanceKind: 'account' as const,
    authStrategyKind: 'token' as const,
  };
  return makeMockContext({ scrape, api, mediator, config });
}

/**
 * Drive the REAL PRE → seal → ACTION → POST chain.
 * @param poolBodies - Cumulative mediator-pool bodies.
 * @returns POST procedure (success or universal-miss failure).
 */
async function drivePost(poolBodies: readonly unknown[]): Promise<Procedure<IPipelineContext>> {
  const ctx = makeCtx(poolBodies);
  const pre = await executeBalanceResolvePre(ctx);
  if (!isOk(pre)) throw new ScraperError('PRE must succeed');
  const sealed = buildActionContext(pre.value);
  const action = await executeBalanceResolveAction(sealed);
  if (!isOk(action)) throw new ScraperError('ACTION must succeed');
  const acted = action.value as unknown as IPipelineContext;
  return executeBalanceResolvePost(acted);
}

describe('BALANCE-RESOLVE captured-seed rescue (FIBI/Beinleumi)', () => {
  it('resolves the folded accountSummary from the cumulative pool when the carried snapshot lacks it', async () => {
    const post = await drivePost([...TXN_ONLY, ACCOUNT_SUMMARY]);
    if (!isOk(post)) throw new ScraperError('POST must succeed (not universal-miss)');
    const report = post.value.balanceValidation;
    if (!report.has) throw new ScraperError('POST must commit a balanceValidation report');
    expect(report.value.totalAccounts).toBe(1);
    expect(report.value.resolvedIds).toHaveLength(1);
  });

  it('honest failure — when neither carried snapshot nor pool carries a balance, universal-misses', async () => {
    const post = await drivePost([...TXN_ONLY]);
    const isPostOk = isOk(post);
    expect(isPostOk).toBe(false);
  });
});
