/**
 * BalanceResolvePhase — thin orchestrator coverage.
 *
 * <p>Phase class delegates each sub-step (.pre/.action/.post/.final) to
 * the Mediator action surface. This file pins each delegation + the
 * factory function so coverage isn't lost when integration tests
 * exercise a different bank's shape.
 */

import {
  BalanceResolvePhase,
  createBalanceResolvePhase,
} from '../../../../Scrapers/Pipeline/Phases/BalanceResolve/BalanceResolvePhase.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../Infrastructure/MockFactories.js';

describe('BalanceResolvePhase — delegation coverage', () => {
  it('createBalanceResolvePhase factory returns a BalanceResolvePhase instance', () => {
    const phase = createBalanceResolvePhase();
    expect(phase).toBeInstanceOf(BalanceResolvePhase);
    expect(phase.name).toBe('balance-resolve');
  });

  it('.pre delegates to executeBalanceResolvePre (default-deny on absent identities)', async () => {
    const phase = createBalanceResolvePhase();
    const ctx = makeMockContext({ scrape: none() });
    const result = await phase.pre(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
  });

  it('.action delegates to executeBalanceResolveAction (empty plan → succeeds)', async () => {
    const phase = createBalanceResolvePhase();
    const ctx = makeMockContext({ balanceFetchPlan: none() });
    const actionCtx = ctx as unknown as Parameters<typeof phase.action>[0];
    const result = await phase.action(actionCtx, actionCtx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });

  it('.post delegates to executeBalanceResolvePost (0 accounts → succeeds)', async () => {
    const phase = createBalanceResolvePhase();
    const extracted = new Map<string, number | 'MISS'>();
    const ctx = makeMockContext({ balanceExtracted: some(extracted) });
    const result = await phase.post(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });

  it('.final delegates to executeBalanceResolveFinal (emits balanceResolution map)', async () => {
    const phase = createBalanceResolvePhase();
    const extracted = new Map<string, number | 'MISS'>([['A', 100]]);
    const ctx = makeMockContext({ balanceExtracted: some(extracted) });
    const result = await phase.final(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });
});
