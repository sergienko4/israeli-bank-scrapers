/**
 * Phase 7d coverage support — exercises the four branches of
 * `executeValidateLoginArea`:
 *
 *   - Browser-absent path (frame count stays 0).
 *   - Login form not detected + no nav + no frames → fails loud.
 *   - Login form detected → succeeds.
 *   - Multi-frame page → succeeds.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { executeValidateLoginArea } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Configuration for {@link makeStubMediator}. */
interface IMediatorStubArgs {
  readonly currentUrl: string;
  readonly probeFound: boolean;
  readonly probeThrows: boolean;
}

/**
 * Build a stub mediator whose getCurrentUrl + resolveVisible are
 * fully configurable per test.
 * @param args - Stub config.
 * @returns Stub IElementMediator.
 */
function makeStubMediator(args: IMediatorStubArgs): IElementMediator {
  /**
   * Stub for the form-gate probe. Throws when `probeThrows` is set
   * so the caller's `.catch((): false => false)` branch fires.
   * @returns Race result with the configured `found` flag.
   */
  const stubResolveVisible = async (): Promise<{ found: boolean }> => {
    await Promise.resolve();
    if (args.probeThrows) throw new ScraperError('stub probe rejection');
    return { found: args.probeFound };
  };
  return {
    /**
     * Stub URL accessor returning the configured currentUrl.
     * @returns The configured currentUrl.
     */
    getCurrentUrl: (): string => args.currentUrl,
    resolveVisible: stubResolveVisible,
  } as unknown as IElementMediator;
}

/** No-op logger stub matching the ScraperLogger surface. */
const STUB_LOGGER: ScraperLogger = {
  /**
   * No-op debug.
   * @returns True.
   */
  debug: (): boolean => true,
  /**
   * No-op trace.
   * @returns True.
   */
  trace: (): boolean => true,
  /**
   * No-op info.
   * @returns True.
   */
  info: (): boolean => true,
  /**
   * No-op warn.
   * @returns True.
   */
  warn: (): boolean => true,
  /**
   * No-op error.
   * @returns True.
   */
  error: (): boolean => true,
} as unknown as ScraperLogger;

describe('HomeActions.executeValidateLoginArea — Phase 7d branches', () => {
  it('passes when URL changed (didNavigate=true)', async () => {
    const mediator = makeStubMediator({
      currentUrl: 'https://bank.fake.example/login',
      probeFound: false,
      probeThrows: false,
    });
    const baseCtx = makeMockContext();
    const ctx: IPipelineContext = { ...baseCtx, browser: none() };
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.fake.example/',
      logger: STUB_LOGGER,
    });
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('passes when login form is detected (probeFound=true)', async () => {
    const mediator = makeStubMediator({
      currentUrl: 'https://bank.fake.example/',
      probeFound: true,
      probeThrows: false,
    });
    const baseCtx = makeMockContext();
    const ctx: IPipelineContext = { ...baseCtx, browser: none() };
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.fake.example/',
      logger: STUB_LOGGER,
    });
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('fails when no nav + no frames + no login form', async () => {
    const mediator = makeStubMediator({
      currentUrl: 'https://bank.fake.example/',
      probeFound: false,
      probeThrows: false,
    });
    const baseCtx = makeMockContext();
    const ctx: IPipelineContext = { ...baseCtx, browser: none() };
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.fake.example/',
      logger: STUB_LOGGER,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('login area not detected');
  });

  it('passes when multi-frame page detected (browser.has + frames > 1)', async () => {
    const mediator = makeStubMediator({
      currentUrl: 'https://bank.fake.example/',
      probeFound: false,
      probeThrows: false,
    });
    const baseCtx = makeMockContext();
    const stubFrames = [{}, {}, {}];
    const stubBrowser = {
      page: {
        /**
         * Stub frames accessor returning a multi-frame array.
         * @returns Stub frame list.
         */
        frames: (): readonly unknown[] => stubFrames,
      },
    };
    const ctx: IPipelineContext = {
      ...baseCtx,
      browser: some(stubBrowser as unknown as IBrowserState),
    };
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.fake.example/',
      logger: STUB_LOGGER,
    });
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('treats probe rejection as no-form-detected (catch branch)', async () => {
    const mediator = makeStubMediator({
      currentUrl: 'https://bank.fake.example/',
      probeFound: false,
      probeThrows: true,
    });
    const baseCtx = makeMockContext();
    const ctx: IPipelineContext = { ...baseCtx, browser: none() };
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.fake.example/',
      logger: STUB_LOGGER,
    });
    expect(result.success).toBe(false);
  });
});
