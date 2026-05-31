/**
 * BALANCE-RESOLVE — branch-coverage edge cases.
 *
 * <p>Surface scope: tiny defensive branches not reachable from the
 * happy-path or fake-api factory tests. Each test pins ONE uncovered
 * branch identified by `coverage/lcov.info`.
 */

import { executeBalanceResolvePost } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

describe('BALANCE-RESOLVE — coverage edges', () => {
  it('POST: balanceValidation present + REVEAL respects resolvedCount/missedCount', async () => {
    const extracted = new Map<string, number | 'MISS'>([['ACC-1', 100]]);
    const validation = some({ resolvedIds: ['ACC-1'], missedIds: [], totalAccounts: 1 });
    const ctx = makeMockContext({
      balanceExtracted: some(extracted),
      balanceValidation: validation,
    });
    const result = await executeBalanceResolvePost(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });

  it('POST: validation absent + extracted absent → safe defaults', async () => {
    const ctx = makeMockContext({
      balanceExtracted: none(),
      balanceValidation: none(),
    });
    const result = await executeBalanceResolvePost(ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
  });
});
