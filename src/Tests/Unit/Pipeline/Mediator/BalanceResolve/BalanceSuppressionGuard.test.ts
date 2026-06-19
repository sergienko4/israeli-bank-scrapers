/**
 * REGRESSION GUARD — R1 account balance MUST NOT be pool-suppressed.
 *
 * Locks the origin/main contract: when SCRAPE emits account identities +
 * a non-empty (dedicated) balance-fetch template, BALANCE-RESOLVE.pre
 * MUST commit a non-empty fetch plan so the live balance fetch proceeds,
 * regardless of what the already-captured network pool happens to hold.
 *
 * <p>PR #381 added a `poolDisprovesBalance` heuristic: when a non-empty
 * captured pool carries no balance, it swaps the template for EMPTY and
 * suppresses the fetch. That mislabels account banks whose balance lives
 * behind a dedicated endpoint (its own JSDoc names "Beinleumi") — their
 * transactions-only pool "disproves" a balance that the live fetch would
 * have retrieved, yielding a false 0 balance.
 *
 * <p>Fire proof: GREEN on origin/main (mediator/pool ignored — the plan
 * is built straight from the template). RED against PR #381 (the pool
 * suppresses the template ⇒ EMPTY_PLAN ⇒ length 0). The positive control
 * (no pool) stays GREEN on both, isolating the pool as the sole cause.
 */

import { executeBalanceResolvePre } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IAccountIdentity,
  IBalanceFetchTemplate,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Account-bank id under test (account-kind, not card-cycle). */
const ACCOUNT_BA = 'BA-ACCOUNT-7781';

/** Dedicated per-account balance endpoint SCRAPE emits (non-empty url). */
const DEDICATED_TEMPLATE: IBalanceFetchTemplate = {
  url: 'https://account-bank.example/api/GetBalance',
  method: 'GET',
  urlQueryKey: 'acct',
};

/** Captured body carrying transactions only — NO balance field anywhere. */
const TXNS_ONLY_BODY = { marker: 'transactions-only-no-balance' };

/**
 * Build a single account-identity map (account-kind bank).
 * @returns One-entry identity map keyed by the bank-account id.
 */
function oneAccountIdentity(): ReadonlyMap<string, IAccountIdentity> {
  const identity: IAccountIdentity = {
    cardDisplayId: ACCOUNT_BA,
    cardUniqueId: `UID-${ACCOUNT_BA}`,
    bankAccountUniqueId: ACCOUNT_BA,
  };
  return new Map([[ACCOUNT_BA, identity]]);
}

/**
 * Build the SCRAPE option: account identities + a non-empty template.
 * @returns Option<IScrapeState> threaded into the mock context.
 */
function accountScrape(): IPipelineContext['scrape'] {
  return some({
    accounts: [],
    accountIdentities: oneAccountIdentity(),
    balanceFetchTemplate: DEDICATED_TEMPLATE,
  });
}

/**
 * Captured-pool reader returning the single balance-free endpoint.
 * @returns One-entry endpoint list whose body carries no balance.
 */
function getNoBalancePool(): readonly IDiscoveredEndpoint[] {
  const endpoint = { responseBody: TXNS_ONLY_BODY } as unknown as IDiscoveredEndpoint;
  return [endpoint];
}

/**
 * Build a mediator whose captured pool carries a non-empty,
 * balance-free transactions body (PR #381's suppression trigger).
 * @returns Option<IElementMediator> wired with one no-balance endpoint.
 */
function poolMediator(): IPipelineContext['mediator'] {
  const network = { getAllEndpoints: getNoBalancePool };
  return some({ network } as unknown as IElementMediator);
}

/**
 * Run PRE and return the committed balance-fetch-plan length (−1 when
 * PRE failed or committed no plan).
 * @param ctx - Pipeline context for BALANCE-RESOLVE.pre.
 * @returns Committed plan length, or −1.
 */
async function committedPlanLength(ctx: IPipelineContext): Promise<number> {
  const result = await executeBalanceResolvePre(ctx);
  if (!isOk(result)) return -1;
  const plan = result.value.balanceFetchPlan;
  return plan.has ? plan.value.length : -1;
}

describe('REGRESSION GUARD — R1 account balance not pool-suppressed', () => {
  it('builds a non-empty plan for an account bank despite a balance-free captured pool', async () => {
    const ctx = makeMockContext({ scrape: accountScrape(), mediator: poolMediator() });
    expect(await committedPlanLength(ctx)).toBeGreaterThanOrEqual(1);
  });

  it('positive control — same account context with no captured pool builds a non-empty plan', async () => {
    const ctx = makeMockContext({ scrape: accountScrape(), mediator: none() });
    expect(await committedPlanLength(ctx)).toBeGreaterThanOrEqual(1);
  });
});
