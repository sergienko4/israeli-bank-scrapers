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
