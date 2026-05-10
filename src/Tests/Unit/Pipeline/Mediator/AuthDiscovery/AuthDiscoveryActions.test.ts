/**
 * Unit tests for AuthDiscoveryActions — branches the factory test
 * does not exercise individually:
 *   - PRE/POST/FINAL no-mediator pass-through paths
 *   - ACTION sealed pass-through (BasePhase template never invokes
 *     this directly in the factory test)
 *   - FINAL pass-through when authDiscovery is none
 */

import {
  executeAuthDiscoveryAction,
  executeAuthDiscoveryFinal,
  executeAuthDiscoveryPost,
  executeAuthDiscoveryPre,
} from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryActions.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IAuthDiscovery,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

describe('AuthDiscoveryActions — focused branch coverage', () => {
  it('PRE returns pass-through success when no mediator is attached', async () => {
    const ctx = makeMockContext();
    const result = await executeAuthDiscoveryPre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('PRE awaits a settle wait via mediator.waitForNetworkIdle BEFORE inventorying captures (post-login redirect grace)', async () => {
    // PR #221 review follow-up: AUTH-DISCOVERY.PRE must give the SPA
    // up to AUTH_DISCOVERY_PRE_SETTLE_MS to flush the post-login
    // redirect chatter so the inventory it reads
    // (`network.getAllEndpoints()`) reflects the final post-login
    // state, not a mid-redirect snapshot. Event-driven (uses
    // `waitForNetworkIdle`) so fast banks pay 0ms; slow banks pay
    // up to the ceiling.
    let didCallSettleWait = false;
    let didCaptureBeforeWait = false;
    const fakeMediator = {
      /**
       * Records that the settle wait was invoked AND that the
       * capture inventory was read AFTER (not before).
       *
       * @returns Resolved succeed (no settle pending).
       */
      waitForNetworkIdle: () => {
        didCallSettleWait = true;
        return Promise.resolve({ success: true as const, value: undefined });
      },
      network: {
        /**
         * Returns empty captures pool. If `didCallSettleWait` is
         * still false at this point, the inventory was read BEFORE
         * the settle wait — assertion fails.
         *
         * @returns Empty captures.
         */
        getAllEndpoints: (): readonly unknown[] => {
          didCaptureBeforeWait = !didCallSettleWait;
          return [];
        },
      },
    } as unknown as IElementMediator;
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true as const, value: fakeMediator },
    };
    const result = await executeAuthDiscoveryPre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    expect(didCallSettleWait).toBe(true);
    expect(didCaptureBeforeWait).toBe(false);
  });

  it('ACTION returns sealed pass-through success on every input shape', async () => {
    const baseCtx = makeMockContext();
    const actionCtx = baseCtx as unknown as IActionContext;
    const result = await executeAuthDiscoveryAction(actionCtx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('POST returns pass-through success when no mediator is attached', async () => {
    const ctx = makeMockContext();
    const result = await executeAuthDiscoveryPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('POST honors MOCK_MODE safety valve and skips the live probe', async () => {
    const original = process.env.MOCK_MODE;
    process.env.MOCK_MODE = '1';
    try {
      const baseCtx = makeMockContext();
      const fakeMediator = {} as IElementMediator;
      const ctx = {
        ...baseCtx,
        mediator: { has: true as const, value: fakeMediator },
      };
      const result = await executeAuthDiscoveryPost(ctx);
      const wasOk = isOk(result);
      expect(wasOk).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.MOCK_MODE;
      } else {
        process.env.MOCK_MODE = original;
      }
    }
  });

  it('FINAL passes through when authDiscovery is none (test path)', async () => {
    const ctx = makeMockContext();
    const result = await executeAuthDiscoveryFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('FINAL emits the committed telemetry event when authDiscovery is some', async () => {
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: 'fake-bearer',
      origin: 'https://example.bank',
      siteId: '10',
      headers: { 'X-Site-Id': '10' },
      dashboardReady: true,
      sessionCookieNames: ['JSESSIONID', 'PSEK'],
    };
    const ctx = { ...baseCtx, authDiscovery: some(snap) };
    const result = await executeAuthDiscoveryFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});
