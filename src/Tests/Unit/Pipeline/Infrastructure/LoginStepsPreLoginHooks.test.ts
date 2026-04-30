/**
 * Unit tests for LoginSteps — createPreLoginStep checkReadiness / preAction hooks.
 */

import type { Frame, Page } from 'playwright-core';

import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { createPreLoginStep } from '../../../../Scrapers/Pipeline/Mediator/Login/LoginSteps.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Pipeline/Infrastructure/MockFactories.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Test helper.
   *
   * @param message - Parameter.
   * @returns Result.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/**
 * Build a mock browser page.
 * @returns Mock Page.
 */
function makePage(): Page {
  return {
    /**
     * url.
     * @returns Empty URL.
     */
    url: (): string => 'https://bank.example/login',
  } as unknown as Page;
}

/**
 * Build a pipeline context with browser present.
 * @returns IPipelineContext.
 */
function ctxWithBrowser(): IPipelineContext {
  const page = makePage();
  const base = makeMockContext();
  return {
    ...base,
    browser: some({ browser: {}, context: {}, page } as unknown as IBrowserState),
  };
}

/**
 * Build a minimal login config.
 * @param overrides - Optional hooks.
 * @returns ILoginConfig.
 */
function makeConfig(overrides: Partial<ILoginConfig> = {}): ILoginConfig {
  const base = {
    loginUrl: 'https://bank.example/login',
    fields: [],
    submit: [],
    possibleResults: { success: [] },
  } as unknown as ILoginConfig;
  return { ...base, ...overrides };
}

describe('createPreLoginStep — runCheckReadiness branches', () => {
  it('succeeds when no checkReadiness / preAction hooks are defined', async () => {
    const makeConfigResult1 = makeConfig();
    const step = createPreLoginStep(makeConfigResult1);
    const ctx = ctxWithBrowser();
    const result = await step.execute(ctx, ctx);
    expect(result.success).toBe(true);
  });

  it('invokes checkReadiness when present (happy path)', async () => {
    let wasCalled = false;
    const config = makeConfig({
      /**
       * Scripted checkReadiness — records invocation.
       * @returns Resolved void.
       */
      checkReadiness: async (): Promise<void> => {
        await Promise.resolve();
        wasCalled = true;
      },
    } as unknown as Partial<ILoginConfig>);
    const step = createPreLoginStep(config);
    const ctx = ctxWithBrowser();
    const result = await step.execute(ctx, ctx);
    expect(result.success).toBe(true);
    expect(wasCalled).toBe(true);
  });

  it('fails when checkReadiness throws', async () => {
    const config = makeConfig({
      /**
       * Scripted checkReadiness that throws.
       * @returns Rejected.
       */
      checkReadiness: async (): Promise<void> => {
        await Promise.resolve();
        throw new TestError('readiness-fail');
      },
    } as unknown as Partial<ILoginConfig>);
    const step = createPreLoginStep(config);
    const ctx = ctxWithBrowser();
    const result = await step.execute(ctx, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('checkReadiness');
  });

  it('uses the frame returned by preAction when provided', async () => {
    const preActionFrame = {
      /**
       * Test helper.
       *
       * @returns Result.
       */
      name: (): string => 'iframe-1',
    } as unknown as Frame;
    const config = makeConfig({
      /**
       * Scripted preAction returning a frame.
       * @returns Frame.
       */
      preAction: (): Promise<Frame> => Promise.resolve(preActionFrame),
    } as unknown as Partial<ILoginConfig>);
    const step = createPreLoginStep(config);
    const ctx = ctxWithBrowser();
    const result = await step.execute(ctx, ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.login.has).toBe(true);
    }
  });

  it('fails when preAction throws', async () => {
    const config = makeConfig({
      /**
       * preAction throws.
       * @returns Rejected.
       */
      preAction: async (): Promise<Frame> => {
        await Promise.resolve();
        throw new TestError('pre-action-fail');
      },
    } as unknown as Partial<ILoginConfig>);
    const step = createPreLoginStep(config);
    const ctx = ctxWithBrowser();
    const result = await step.execute(ctx, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('preAction');
  });

  it('fails when no browser context is available', async () => {
    const makeConfigResult2 = makeConfig();
    const step = createPreLoginStep(makeConfigResult2);
    const ctx = makeMockContext();
    const result = await step.execute(ctx, ctx);
    expect(result.success).toBe(false);
  });
});
