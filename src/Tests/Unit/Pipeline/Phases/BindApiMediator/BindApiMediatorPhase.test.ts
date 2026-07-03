/**
 * BIND-API-MEDIATOR phase — unit tests.
 *
 * Proves the phase provisions a live-page ApiMediator for browser
 * hard-model banks, is idempotent when a mediator already exists
 * (headless banks), and fails loudly when no browser is present (wiring
 * bug). No live network — the mock page only needs `url()`.
 */

import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import { CompanyTypes } from '../../../../../Definitions.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import { createBindApiMediatorPhase } from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorPhase.js';
import type { IBrowserState } from '../../../../../Scrapers/Pipeline/Types/Domain/BrowserState.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Overrides accepted by {@link makeCtx}. */
interface ICtxOverrides {
  readonly browserPresent: boolean;
  readonly mediator: IPipelineContext['apiMediator'];
}

/**
 * Build a minimal action context for the bind phase.
 * @param overrides - browser presence + mediator slot.
 * @returns Action context stub with the fields the bind path reads.
 */
function makeCtx(overrides: ICtxOverrides): IActionContext {
  const page = { url: jest.fn().mockReturnValue('https://example.co.il/home') } as unknown as Page;
  const browser: IPipelineContext['browser'] = overrides.browserPresent
    ? some({ page, context: {}, cleanups: [] } as unknown as IBrowserState)
    : none();
  const ctx = { companyId: CompanyTypes.Discount, browser, apiMediator: overrides.mediator };
  return ctx as unknown as IActionContext;
}

describe('BindApiMediatorPhase', () => {
  it('binds a browser-page ApiMediator when the browser slot is present', async () => {
    const ctx = makeCtx({ browserPresent: true, mediator: none() });
    const phase = createBindApiMediatorPhase();
    const result = await phase.action(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) {
      const out = result.value as unknown as IPipelineContext;
      expect(out.apiMediator.has).toBe(true);
    }
  });

  it('passes through unchanged when a mediator already exists (idempotent)', async () => {
    const existing = some({} as unknown as IApiMediator);
    const ctx = makeCtx({ browserPresent: true, mediator: existing });
    const phase = createBindApiMediatorPhase();
    const result = await phase.action(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isSuccess) expect(result.value).toBe(ctx);
  });

  it('fails loudly when no browser slot is present (wiring bug)', async () => {
    const ctx = makeCtx({ browserPresent: false, mediator: none() });
    const phase = createBindApiMediatorPhase();
    const result = await phase.action(ctx, ctx);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(false);
    if (!isSuccess) expect(result.errorMessage).toContain('no browser');
  });
});
