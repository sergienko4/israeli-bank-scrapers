/**
 * BIND-API-MEDIATOR phase - unit tests.
 *
 * Proves the phase provisions a live-page ApiMediator in its PRE stage
 * (the only stage that receives the full context carrying `browser`), is
 * idempotent when a mediator already exists (headless banks), and fails
 * loudly when no browser is present (wiring bug). A regression guard
 * proves the ACTION stage is a pure no-op that never touches `browser` -
 * the sealed action context strips it, which is exactly why the bind must
 * live in PRE. No live network - the mock page only needs `url()`.
 */

import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import { CompanyTypes } from '../../../../../Definitions.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import type { INetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Discovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import { buildActionContext } from '../../../../../Scrapers/Pipeline/Phases/Base/ActionContextBuilder.js';
import { createBindApiMediatorPhase } from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorPhase.js';
import type { IBrowserState } from '../../../../../Scrapers/Pipeline/Types/Domain/BrowserState.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Overrides accepted by {@link makeCtx}. */
interface ICtxOverrides {
  readonly browserPresent: boolean;
  readonly apiMediator: IPipelineContext['apiMediator'];
  readonly elementMediatorPresent?: boolean;
}

/**
 * Build a minimal full pipeline context for the bind PRE stage. The element
 * `mediator` slot is always an Option (never undefined in a real run); when
 * present its `.has` is true, which is what makes {@link buildActionContext}
 * seal the ACTION context and strip `browser` - the exact precondition of
 * the original post-login crash the regression guard reproduces.
 * @param overrides - browser presence, apiMediator slot, mediator presence.
 * @returns Pipeline context stub with the fields the bind path reads.
 */
function makeCtx(overrides: ICtxOverrides): IPipelineContext {
  const page = { url: jest.fn().mockReturnValue('https://example.co.il/home') } as unknown as Page;
  const browser: IPipelineContext['browser'] = overrides.browserPresent
    ? some({ page, context: {}, cleanups: [] } as unknown as IBrowserState)
    : none();
  const network = {
    getAllEndpoints: jest.fn((): readonly IDiscoveredEndpoint[] => []),
  } as unknown as INetworkDiscovery;
  const mediator = (
    overrides.elementMediatorPresent ? some({ network }) : none()
  ) as IPipelineContext['mediator'];
  const config = {
    urls: { base: 'https://example.co.il/' },
    balanceKind: 'account',
    authStrategyKind: 'session-cookie',
  } as const;
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const ctx = {
    companyId: CompanyTypes.Discount,
    browser,
    apiMediator: overrides.apiMediator,
    mediator,
    config,
    logger,
  };
  return ctx as unknown as IPipelineContext;
}

describe('BindApiMediatorPhase', () => {
  it('binds a browser-page ApiMediator in PRE when the browser slot is present', async () => {
    const ctx = makeCtx({ browserPresent: true, apiMediator: none() });
    const phase = createBindApiMediatorPhase();
    const result = await phase.pre(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value.apiMediator.has).toBe(true);
  });

  it('binds + runs the session-token / BaNCS primes when an element mediator is present', async () => {
    const ctx = makeCtx({
      browserPresent: true,
      apiMediator: none(),
      elementMediatorPresent: true,
    });
    const phase = createBindApiMediatorPhase();
    const result = await phase.pre(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value.apiMediator.has).toBe(true);
  });

  it('passes through unchanged when a mediator already exists (idempotent)', async () => {
    const existing = some({} as unknown as IApiMediator);
    const ctx = makeCtx({ browserPresent: true, apiMediator: existing });
    const phase = createBindApiMediatorPhase();
    const result = await phase.pre(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toBe(ctx);
  });

  it('fails loudly when no browser slot is present (wiring bug)', async () => {
    const ctx = makeCtx({ browserPresent: false, apiMediator: none() });
    const phase = createBindApiMediatorPhase();
    const result = await phase.pre(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!isSuccess) expect(result.errorMessage).toContain('no browser');
  });

  it('ACTION survives the REAL sealed context that strips browser (regression guard)', async () => {
    const ctx = makeCtx({
      browserPresent: false,
      apiMediator: none(),
      elementMediatorPresent: true,
    });
    const sealed = buildActionContext(ctx);
    expect('browser' in sealed).toBe(false);
    const phase = createBindApiMediatorPhase();
    const result = await phase.action(sealed, sealed);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toBe(sealed);
  });
});
