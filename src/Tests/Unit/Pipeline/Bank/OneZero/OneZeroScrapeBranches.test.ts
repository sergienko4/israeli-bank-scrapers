/**
 * Unit tests for OneZeroScrape — failure + edge branches.
 * Covers: customer-query fail, empty-portfolio guard, movements-query fail,
 * stopPredicate edge cases, pagination null-cursor coerce, mid-stream failure.
 * Shares fixtures with OneZeroScrape.test.ts via OneZeroScrapeTestHelpers.ts.
 */

import { oneZeroApiScrape } from '../../../../../Scrapers/Pipeline/Banks/OneZero/scrape/OneZeroScrape.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
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

describe('oneZeroApiScrape — failure + edge branches', () => {
  it('customer query fails → propagates fail without fetching movements', async () => {
    const customerFail = failGeneric('customer bad');
    const bus = makeMediator({ customer: [customerFail] });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    expect(result.success).toBe(false);
  });

  it('portfolio with zero accounts → skipped silently (0 accounts scraped)', async () => {
    const emptyPortfolio = { portfolioId: 'pf-empty', portfolioNum: 'num-empty', accounts: [] };
    const customerPayload = customerEnvelope([emptyPortfolio]);
    const bus = makeMediator({ customer: [succeed(customerPayload)] });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    expect(scrape.value.accounts).toHaveLength(0);
  });

  it('movements page query fails → propagates fail', async () => {
    const customerPayload = customerEnvelope([SYN_PORTFOLIO_1]);
    const txnFail = failGeneric('txn bad');
    const bus = makeMediator({
      customer: [succeed(customerPayload)],
      transactions: [txnFail],
    });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    expect(result.success).toBe(false);
  });

  it('customer entry with missing portfolios field → falls back to empty list', async () => {
    const customerPayload = { customer: [{}] };
    const bus = makeMediator({ customer: [succeed(customerPayload)] });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    expect(scrape.value.accounts).toHaveLength(0);
  });

  it('mid-stream portfolio failure short-circuits remaining portfolios', async () => {
    const twoPortfolios = [SYN_PORTFOLIO_1, SYN_PORTFOLIO_2];
    const customerPayload = customerEnvelope(twoPortfolios);
    const p1Payload = movementsEnvelope([synMovement('a', 1, '2026-04-10T00:00:00')], false, '');
    const balP1 = balanceEnvelope(7);
    const txnFailSecond = failGeneric('second txn bad');
    const bus = makeMediator({
      customer: [succeed(customerPayload)],
      transactions: [succeed(p1Payload), txnFailSecond],
      balance: [succeed(balP1)],
    });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    expect(result.success).toBe(false);
  });

  it('movement with non-string movementTimestamp → stopPredicate skips', async () => {
    const weird = { movementId: 'num', movementTimestamp: 20260410, movementAmount: 1 };
    const page1 = [weird];
    const customerPayload = customerEnvelope([SYN_PORTFOLIO_1]);
    const page1Payload = movementsEnvelope(page1, false, '');
    const balPayload = balanceEnvelope(1);
    const bus = makeMediator({
      customer: [succeed(customerPayload)],
      transactions: [succeed(page1Payload)],
      balance: [succeed(balPayload)],
    });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    assertOk(result);
  });

  it('pagination cursor null with hasMore=true → coerces to false and stops', async () => {
    const page1 = [synMovement('x', 1, '2026-04-10T00:00:00')];
    const basePayload = movementsEnvelope(page1, true, '');
    const nullCursorPayload = basePayload as {
      movements: { pagination: { cursor: string | null } };
    };
    nullCursorPayload.movements.pagination.cursor = null;
    const customerPayload = customerEnvelope([SYN_PORTFOLIO_1]);
    const balPayload = balanceEnvelope(3);
    const bus = makeMediator({
      customer: [succeed(customerPayload)],
      transactions: [succeed(basePayload)],
      balance: [succeed(balPayload)],
    });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    assertOk(result);
  });

  it('movement with empty movementTimestamp → stopPredicate skips (keeps paginating)', async () => {
    const page1 = [synMovement('m1', 10, '2026-04-10T00:00:00')];
    const malformed = { movementId: 'bad', movementTimestamp: '', movementAmount: 2 };
    const page2 = [malformed];
    const customerPayload = customerEnvelope([SYN_PORTFOLIO_1]);
    const page1Payload = movementsEnvelope(page1, true, 'cursor-p2');
    const page2Payload = movementsEnvelope(page2, false, '');
    const balPayload = balanceEnvelope(5);
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
    expect(first.txns).toHaveLength(1);
  });

  it('movement older than startDate stops pagination early', async () => {
    const oldMove = synMovement('old', 1, '2020-01-01T00:00:00');
    const customerPayload = customerEnvelope([SYN_PORTFOLIO_1]);
    const oldPayload = movementsEnvelope([oldMove], true, 'never-reached');
    const balPayload = balanceEnvelope(0);
    const bus = makeMediator({
      customer: [succeed(customerPayload)],
      transactions: [succeed(oldPayload)],
      balance: [succeed(balPayload)],
    });
    const ctx = makeCtx(bus);
    const result = await oneZeroApiScrape(ctx);
    assertOk(result);
    const scrape = result.value.scrape;
    assertHas(scrape);
    expect(scrape.value.accounts).toHaveLength(1);
  });
});
