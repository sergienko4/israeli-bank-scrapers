/**
 * Phase 7d coverage support — exercises the four branches of
 * `executeValidateLoginArea`:
 *
 *   - Browser-absent path (frame count stays 0).
 *   - Login form not detected + no nav + no frames → fails loud.
 *   - Login form detected → succeeds.
 *   - Multi-frame page → succeeds.
 */

import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { executeValidateLoginArea } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
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
    if (args.probeThrows) throw new Error('stub probe rejection');
    return { found: args.probeFound };
  };
  return {
    getCurrentUrl: (): string => args.currentUrl,
    resolveVisible: stubResolveVisible,
  } as unknown as IElementMediator;
}

/** Stub logger that swallows debug messages. */
const stubLogger = {
  debug: (): void => undefined,
} as never;

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
      logger: stubLogger,
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
      logger: stubLogger,
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
      logger: stubLogger,
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
      page: { frames: (): readonly unknown[] => stubFrames },
    };
    const ctx: IPipelineContext = { ...baseCtx, browser: some(stubBrowser as never) };
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.fake.example/',
      logger: stubLogger,
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
      logger: stubLogger,
    });
    expect(result.success).toBe(false);
  });
});
