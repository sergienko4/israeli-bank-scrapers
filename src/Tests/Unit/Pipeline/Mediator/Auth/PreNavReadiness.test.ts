/**
 * Coverage for `PreNavReadiness` — the auth-side gatekeeper used by
 * LOGIN.FINAL and OTP-FILL.FINAL. Verifies the three-way contract:
 * - skip when no captures landed yet (later auth phase will run it),
 * - succeed when pre-nav holds an account container,
 * - fail loud when captures are present but no account container.
 */

import {
  hasAccountContainerInPreNav,
  shouldSkipPreNavCheck,
  verifyPreNavReadiness,
} from '../../../../../Scrapers/Pipeline/Mediator/Auth/PreNavReadiness.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/**
 * Build a synthetic endpoint with a forced response body.
 * @param body - Response body literal.
 * @returns Endpoint stub.
 */
function makeEndpoint(body: unknown): IDiscoveredEndpoint {
  return {
    url: 'https://test.example/api/x',
    method: 'GET',
    postData: '',
    responseBody: body,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 0,
  };
}

/**
 * Build a context whose mediator returns canned bucket contents.
 * @param preNav - Pre-nav captures the network mock should expose.
 * @param all - Total endpoints the network mock should expose.
 * @returns Pipeline context stub.
 */
function makeCtx(
  preNav: readonly IDiscoveredEndpoint[],
  all: readonly IDiscoveredEndpoint[],
): ReturnType<typeof makeMockContext> {
  const baseCtx = makeMockContext();
  return {
    ...baseCtx,
    mediator: {
      has: true,
      value: {
        network: {
          /**
           * Forced pre-nav captures.
           * @returns Pre-nav array.
           */
          getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => preNav,
          /**
           * Forced full capture list.
           * @returns All endpoints.
           */
          getAllEndpoints: (): readonly IDiscoveredEndpoint[] => all,
        },
      },
    },
  } as unknown as ReturnType<typeof makeMockContext>;
}

describe('shouldSkipPreNavCheck', () => {
  it('skips when ctx.mediator is absent', () => {
    const ctx = makeMockContext();
    const isSkipped = shouldSkipPreNavCheck(ctx);
    expect(isSkipped).toBe(true);
  });

  it('skips when network has zero captures yet', () => {
    const ctx = makeCtx([], []);
    const isSkipped = shouldSkipPreNavCheck(ctx);
    expect(isSkipped).toBe(true);
  });

  it('does not skip when captures are present', () => {
    const ep = makeEndpoint({ unrelated: true });
    const ctx = makeCtx([ep], [ep]);
    const isSkipped = shouldSkipPreNavCheck(ctx);
    expect(isSkipped).toBe(false);
  });
});

describe('hasAccountContainerInPreNav', () => {
  it('returns false when mediator absent', () => {
    const ctx = makeMockContext();
    const hasContainer = hasAccountContainerInPreNav(ctx);
    expect(hasContainer).toBe(false);
  });

  it('returns false when no capture body matches', () => {
    const ctx = makeCtx([makeEndpoint({ foo: 'bar' })], []);
    const hasContainer = hasAccountContainerInPreNav(ctx);
    expect(hasContainer).toBe(false);
  });

  it('returns true when a capture exposes a "cards" container', () => {
    const ep = makeEndpoint({ cards: [{ accountId: 'abc' }] });
    const ctx = makeCtx([ep], [ep]);
    const hasContainer = hasAccountContainerInPreNav(ctx);
    expect(hasContainer).toBe(true);
  });
});

describe('verifyPreNavReadiness', () => {
  it('succeeds when no captures have landed (gate not yet on)', () => {
    const ctx = makeCtx([], []);
    const result = verifyPreNavReadiness(ctx, 'LOGIN');
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
  });

  it('succeeds when account container is present in pre-nav', () => {
    const ep = makeEndpoint({ accounts: [{ accountId: 'abc-1' }] });
    const ctx = makeCtx([ep], [ep]);
    const result = verifyPreNavReadiness(ctx, 'OTP-FILL');
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
  });

  it('fails loud when captures exist but no account container is found', () => {
    const ep = makeEndpoint({ unrelated: 'no-container' });
    const ctx = makeCtx([ep], [ep]);
    const result = verifyPreNavReadiness(ctx, 'LOGIN');
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('no account/cards container');
      expect(result.errorMessage).toContain('LOGIN');
    }
  });
});
