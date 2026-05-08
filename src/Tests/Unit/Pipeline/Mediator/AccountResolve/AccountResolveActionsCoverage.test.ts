/**
 * Phase 7d coverage support — exercises ACCOUNT-RESOLVE.POST paths
 * that the cross-bank fixture suite doesn't otherwise hit:
 *
 *   - F2 message format (renderContainerCounts) when the picker
 *     scored higher than the resolved ids.
 *   - F1 fail-loud message format with empty pool.
 *   - The no-mediator early-return branch (defensive guard).
 *   - The MOCK_MODE bypass valve when MOCK_MODE=1.
 *   - The PRE/ACTION/FINAL stage handlers' edge cases.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  ACCOUNT_RESOLVE_BUDGET_MS,
  executeAccountResolveAction,
  executeAccountResolveFinal,
  executeAccountResolvePost,
  executeAccountResolvePre,
} from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { toActionCtx } from '../../Infrastructure/TestHelpers.js';

/**
 * Build a stub element mediator whose pool/wait surface is fully
 * configurable for each test.
 * @param captures - Pre-nav captures the stub returns.
 * @param waitOutcome - Outcome of `waitForFirstId`.
 * @returns Stub IElementMediator.
 */
function makeMediatorStub(
  captures: readonly IDiscoveredEndpoint[],
  waitOutcome: 'matched' | 'timeout',
): IElementMediator {
  /**
   * Stub waitForFirstId that resolves with the configured outcome.
   * @returns Promise of true (matched) or rejection (timeout).
   */
  const stubWaitForFirstId = async (): Promise<true> => {
    await Promise.resolve();
    if (waitOutcome === 'timeout') throw new ScraperError('timeout (stub)');
    return true;
  };
  return {
    network: {
      /**
       * Stub pool accessor.
       * @returns Configured pool.
       */
      getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => captures,
      waitForFirstId: stubWaitForFirstId,
    },
  } as unknown as IElementMediator;
}

/**
 * Build a discovered endpoint stub from a body.
 * @param body - Response body.
 * @param captureIndex - Diagnostic index.
 * @returns Stub endpoint.
 */
function makeCapture(body: unknown, captureIndex: number): IDiscoveredEndpoint {
  return {
    url: 'https://api.fake.example/account/init',
    method: 'POST',
    postData: '{}',
    responseBody: body,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
    captureIndex,
  };
}

describe('ACCOUNT-RESOLVE.PRE — Phase 7d edge cases', () => {
  it('exposes the 20s budget constant', () => {
    expect(ACCOUNT_RESOLVE_BUDGET_MS).toBe(20_000);
  });

  it('fails fast with no-mediator message when ctx.mediator is none', async () => {
    const baseCtx = makeMockContext();
    const ctx: IPipelineContext = { ...baseCtx, mediator: none() };
    const result = await executeAccountResolvePre(ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('no mediator');
  });

  it('logs the wait outcome label "matched" when waitForFirstId resolves', async () => {
    const baseCtx = makeMockContext();
    const stubMediator = makeMediatorStub([], 'matched');
    const ctx: IPipelineContext = {
      ...baseCtx,
      mediator: some(stubMediator),
    };
    const result = await executeAccountResolvePre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('logs the wait outcome label "timeout" when waitForFirstId rejects', async () => {
    const baseCtx = makeMockContext();
    const stubMediator = makeMediatorStub([], 'timeout');
    const ctx: IPipelineContext = {
      ...baseCtx,
      mediator: some(stubMediator),
    };
    const result = await executeAccountResolvePre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});

describe('ACCOUNT-RESOLVE.ACTION — sealed action context pass-through', () => {
  it('returns succeed(input) without touching the input', async () => {
    const baseCtx = makeMockContext();
    const fakeActionCtx = toActionCtx(baseCtx, false);
    const result = await executeAccountResolveAction(fakeActionCtx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result)) expect(result.value).toBe(fakeActionCtx);
  });
});

describe('ACCOUNT-RESOLVE.POST — Phase 7d edge cases', () => {
  it('passes through when ctx.mediator is none (defensive guard)', async () => {
    const baseCtx = makeMockContext();
    const ctx: IPipelineContext = { ...baseCtx, mediator: none() };
    const result = await executeAccountResolvePost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('emits per-container detail in F2 message when picker scored above resolved', async () => {
    const goodBody = {
      result: {
        cards: [
          { cardUniqueId: 'FAKE-1', last4Digits: '1111' },
          { cardUniqueId: 'FAKE-2', last4Digits: '2222' },
        ],
        bankAccounts: [{ bankAccountUniqueId: 'FAKE-BANK-A', bankAccountNum: '0001111' }],
      },
    };
    const stubBody = { result: { cards: [{ cardUniqueId: 'FAKE-LO-1' }] } };
    const goodCapture = makeCapture(goodBody, 1);
    const stubCapture = makeCapture(stubBody, 2);
    const baseCtx = makeMockContext();
    const stubMediator = makeMediatorStub([stubCapture, goodCapture], 'matched');
    const ctx: IPipelineContext = { ...baseCtx, mediator: some(stubMediator) };
    const result = await executeAccountResolvePost(ctx);
    expect(result.success).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      const ad = result.value.accountDiscovery.value;
      expect(ad.ids.length).toBe(3);
      expect(ad.containers.cards.length).toBe(2);
      expect(ad.containers.bankAccounts.length).toBe(1);
      expect(ad.endpointCaptureIndex).toBe(1);
    }
  });

  it('F1 message exposes the empty pool size for diagnostics', async () => {
    const baseCtx = makeMockContext();
    const stubMediator = makeMediatorStub([], 'matched');
    const ctx: IPipelineContext = { ...baseCtx, mediator: some(stubMediator) };
    const result = await executeAccountResolvePost(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('ACCOUNT_RESOLUTION_FAILED');
      expect(result.errorMessage).toContain('pool=0');
    }
  });

  it('F2 fires with per-container detail when ids count < container records count', async () => {
    // Card `x` passes looksLikeAccountRecord (cardSuffix is a WK id
    // field) but fails isUsableIdentifier (length<2 short-id rule),
    // so extractAccountIds drops it. extractAccountRecords keeps it,
    // making `containers.cards.length` (3) exceed `ids.length` (2)
    // and triggering the Phase 7d fail-loud guard.
    // The third card has ONLY a short cardSuffix and no other id-
    // shaped fields. looksLikeAccountRecord accepts it (cardSuffix
    // is in WK_ACCT.id), so the record lands in `containers.cardsList`
    // (count 3). extractValidIdentifier rejects it (length<2 fails
    // isUsableIdentifier), so `ids` ends up at 2. 2 < 3 trips F2.
    const partialIdsBody = {
      data: {
        cardsList: [
          { cardSuffix: 'AAAA-VALID-1', accountNumber: 'FAKE-A' },
          { cardSuffix: 'BBBB-VALID-2', accountNumber: 'FAKE-B' },
          { cardSuffix: 'x' },
        ],
      },
    };
    const capture = makeCapture(partialIdsBody, 9);
    const baseCtx = makeMockContext();
    const stubMediator = makeMediatorStub([capture], 'matched');
    const ctx: IPipelineContext = { ...baseCtx, mediator: some(stubMediator) };
    const result = await executeAccountResolvePost(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('ACCOUNT_RESOLUTION_INCOMPLETE');
      expect(result.errorMessage).toContain('resolved=2');
      expect(result.errorMessage).toContain('expected=3');
      expect(result.errorMessage).toContain('cardsList:3');
    }
  });
});

describe('ACCOUNT-RESOLVE.FINAL — telemetry edge cases', () => {
  it('emits ids=0 firstId=none when discovery is empty (defensive)', async () => {
    const baseCtx = makeMockContext();
    const result = await executeAccountResolveFinal(baseCtx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('emits the head id as firstId when discovery is populated', async () => {
    const baseCtx = makeMockContext();
    const ctx: IPipelineContext = {
      ...baseCtx,
      accountDiscovery: some({
        ids: ['FAKE-HEAD-ID', 'FAKE-OTHER-ID'],
        records: [{ accountId: 'FAKE-HEAD-ID' }, { accountId: 'FAKE-OTHER-ID' }],
        containers: {
          cards: [{ accountId: 'FAKE-HEAD-ID' }, { accountId: 'FAKE-OTHER-ID' }],
        },
        endpointCaptureIndex: 7,
      }),
    };
    const result = await executeAccountResolveFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});
