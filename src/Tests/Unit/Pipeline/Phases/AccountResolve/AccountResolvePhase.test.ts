/**
 * Phase 7 — AccountResolvePhase BasePhase wiring.
 *
 * Verifies the phase delegates to mediator handlers in the right
 * order and surfaces their failures verbatim. Bank-fixture coverage
 * lives in `AccountResolveActions.test.ts`.
 */

import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import {
  AccountResolvePhase,
  createAccountResolvePhase,
} from '../../../../../Scrapers/Pipeline/Phases/AccountResolve/AccountResolvePhase.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/**
 * Build a stub mediator whose pre-nav pool yields the given account
 * shape. Used to drive the phase end-to-end without a Playwright Page.
 * @param idCapture - Capture exposing an account id (or none).
 * @returns Stub mediator.
 */
function makeStubMediator(idCapture: IDiscoveredEndpoint | false): IElementMediator {
  const pool: readonly IDiscoveredEndpoint[] = idCapture === false ? [] : [idCapture];
  return {
    network: {
      /**
       * Returns the configured pool.
       * @returns Pre-nav captures.
       */
      getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => pool,
      /**
       * Resolves with the configured capture (or false on empty pool).
       * @returns Match endpoint or false.
       */
      waitForFirstId: (): Promise<IDiscoveredEndpoint | false> => Promise.resolve(idCapture),
    },
    /**
     * Smart-wait race stub (added PR #234) — never resolves so the
     * outcome is decided by `waitForFirstId`.
     * @returns Promise that never resolves.
     */
    /** Smart-wait mock — awaits the custom wait so test stubs run.
     * @param cw - Caller-supplied custom wait promise.
     * @returns True after the custom wait settles. */
    raceWithNetworkIdle: async (cw: Promise<unknown>): Promise<true> => {
      try {
        await cw;
      } catch {
        /* swallow */
      }
      return true as const;
    },
    /**
     * Best-effort PRE nudge click stub (no pool mutation). On the empty
     * pool the nudge fires, finds no id on re-wait, and POST then fails
     * loud — exactly the honest-failure path this phase test asserts.
     * @returns Resolved click sentinel.
     */
    resolveAndClick: (): Promise<unknown> => Promise.resolve(true),
  } as unknown as IElementMediator;
}

/**
 * Build a synthetic account-shaped capture.
 * @returns Hapoalim-style URL-query capture.
 */
function makeIdCapture(): IDiscoveredEndpoint {
  return {
    url: 'https://login.hapoalim.example/Authorizations?accountId=[REDACTED-ACCT]',
    method: 'GET',
    postData: '',
    responseBody: { ok: true },
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
  };
}

describe('AccountResolvePhase', () => {
  it('reports phase name = "account-resolve"', () => {
    const phase = createAccountResolvePhase();
    expect(phase.name).toBe('account-resolve');
    expect(phase).toBeInstanceOf(AccountResolvePhase);
  });

  it('PRE → ACTION → POST → FINAL: commits accountDiscovery on id-bearing pool', async () => {
    const phase = createAccountResolvePhase();
    const idCapture = makeIdCapture();
    const mediator = makeStubMediator(idCapture);
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await phase.run(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.accountDiscovery.has).toBe(true);
      if (result.value.accountDiscovery.has) {
        expect(result.value.accountDiscovery.value.ids).toContain('[REDACTED-ACCT]');
      }
    }
  });

  it('fails the run loud when pre-nav pool yields no id-bearing capture', async () => {
    const phase = createAccountResolvePhase();
    const mediator = makeStubMediator(false);
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: mediator },
    } as IPipelineContext;
    const result = await phase.run(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('ACCOUNT_RESOLUTION_FAILED');
    }
  });

  it('fails fast at PRE when mediator is absent', async () => {
    const phase = createAccountResolvePhase();
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('ACCOUNT-RESOLVE');
      expect(result.errorMessage).toContain('no mediator');
    }
  });
});
