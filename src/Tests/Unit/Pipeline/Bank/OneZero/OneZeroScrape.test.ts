/**
 * Unit tests for OneZeroScrape — happy paths + multi-portfolio.
 * Covers: missing mediator guard, single/multi-page pagination, multi-portfolio
 * iteration, and balance-fail fallback to 0. Failure/edge branches live in
 * OneZeroScrapeBranches.test.ts (shared helpers in OneZeroScrapeTestHelpers.ts).
 */

import { oneZeroApiScrape } from '../../../../../Scrapers/Pipeline/Banks/OneZero/scrape/OneZeroScrape.js';
import { none } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext, makeMockOptions } from '../../Infrastructure/MockFactories.js';
import {
  balanceEnvelope,
  customerEnvelope,
  failGeneric,
  makeCtx,
  makeMediator,
  movementsEnvelope,
  SYN_PORTFOLIO_1,
  SYN_PORTFOLIO_2,
  synMovement,
} from './OneZeroScrapeTestHelpers.js';

describe('oneZeroApiScrape — guards', () => {
  it('missing mediator → fail with "ApiMediator missing"', async () => {
    const opts = makeMockOptions();
    const ctx = makeMockContext({ options: opts });
    const action = { ...ctx, mediator: none() } as unknown as IActionContext;
    const result = await oneZeroApiScrape(action);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('ApiMediator missing');
  });
});

describe('oneZeroApiScrape — single portfolio', () => {
  it('single-page movements → one account with balance + txns', async () => {
    const movements = [synMovement('m1', 10, '2026-04-10T00:00:00')];
    const customerPayload = customerEnvelope([SYN_PORTFOLIO_1]);
    const txnPayload = movementsEnvelope(movements, false, '');
    const balPayload = balanceEnvelope(123.45);
    const bus = makeMediator({
      customer: [succeed(customerPayload)],
      transactions: [succeed(txnPayload)],
      balance: [succeed(balPayload)],
    });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    expect(scrape.value.accounts).toHaveLength(1);
    const first = scrape.value.accounts[0];
    expect(first.balance).toBe(123.45);
    expect(first.accountNumber).toBe(SYN_PORTFOLIO_1.portfolioNum);
    expect(first.txns).toHaveLength(1);
  });

  it('multi-page movements (hasMore=true then false) → both pages merged', async () => {
    const page1 = [synMovement('m1', 10, '2026-04-10T00:00:00')];
    const page2 = [synMovement('m2', 20, '2026-04-11T00:00:00')];
    const customerPayload = customerEnvelope([SYN_PORTFOLIO_1]);
    const page1Payload = movementsEnvelope(page1, true, 'cursor-p2');
    const page2Payload = movementsEnvelope(page2, false, '');
    const balPayload = balanceEnvelope(9);
    const bus = makeMediator({
      customer: [succeed(customerPayload)],
      transactions: [succeed(page1Payload), succeed(page2Payload)],
      balance: [succeed(balPayload)],
    });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    const first = scrape.value.accounts[0];
    expect(first.txns).toHaveLength(2);
  });

  it('balance query fails → falls back to 0', async () => {
    const movements = [synMovement('m1', 5, '2026-04-10T00:00:00')];
    const customerPayload = customerEnvelope([SYN_PORTFOLIO_1]);
    const txnPayload = movementsEnvelope(movements, false, '');
    const balFail = failGeneric('balance fail');
    const bus = makeMediator({
      customer: [succeed(customerPayload)],
      transactions: [succeed(txnPayload)],
      balance: [balFail],
    });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    const first = scrape.value.accounts[0];
    expect(first.balance).toBe(0);
  });
});

describe('oneZeroApiScrape — multi portfolio', () => {
  it('iterates portfolios in order → 2 accounts in response', async () => {
    const customerPayload = customerEnvelope([SYN_PORTFOLIO_1, SYN_PORTFOLIO_2]);
    const p1Movement = [synMovement('a', 1, '2026-04-10T00:00:00')];
    const p2Movement = [synMovement('b', 2, '2026-04-11T00:00:00')];
    const p1Payload = movementsEnvelope(p1Movement, false, '');
    const p2Payload = movementsEnvelope(p2Movement, false, '');
    const b1Payload = balanceEnvelope(11);
    const b2Payload = balanceEnvelope(22);
    const bus = makeMediator({
      customer: [succeed(customerPayload)],
      transactions: [succeed(p1Payload), succeed(p2Payload)],
      balance: [succeed(b1Payload), succeed(b2Payload)],
    });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    expect(scrape.value.accounts).toHaveLength(2);
    const first = scrape.value.accounts[0];
    const second = scrape.value.accounts[1];
    expect(first.accountNumber).toBe(SYN_PORTFOLIO_1.portfolioNum);
    expect(second.accountNumber).toBe(SYN_PORTFOLIO_2.portfolioNum);
  });
});
