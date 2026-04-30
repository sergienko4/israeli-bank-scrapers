/**
 * Unit tests for LoginPhaseActions — executeDiscoverForm field discovery paths.
 * Split from LoginPhaseActions.test.ts to honor max-lines (300).
 */

import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { executeDiscoverForm } from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import type { IBrowserState } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeContextWithBrowser } from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage } from './TestHelpers.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Build a TestError with a message.
   * @param message - Error text.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/**
 * Narrow a ctx.browser field to ISome and return the state.
 * @param ctx - Pipeline ctx.
 * @param ctx.browser - Browser option.
 * @param ctx.browser.has - Present flag.
 * @returns Browser state value.
 */
function requireBrowser(ctx: { browser: { has: boolean } }): IBrowserState {
  if (!ctx.browser.has) throw new TestError('expected browser state');
  return (ctx.browser as { has: true; value: IBrowserState }).value;
}

/** ILoginConfig with one password field for richer discovery. */
const CONFIG_WITH_FIELDS = {
  loginUrl: 'https://bank.example.com/login',
  fields: [
    {
      credentialKey: 'password',
      selectors: [{ kind: 'placeholder' as const, value: 'pwd' }],
    },
  ],
  submit: [{ kind: 'textContent' as const, value: 'Login' }],
  possibleResults: {},
};

describe('executeDiscoverForm — field discovery paths', () => {
  it('discovers with preAction returning a frame-like object', async () => {
    const makeScreenshotPageResult33 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult33);
    const frameLike = requireBrowser(ctx).page;
    const config = {
      ...CONFIG_WITH_FIELDS,
      /**
       * Return a concrete frame object.
       * @returns Frame-like.
       */
      preAction: (): Promise<typeof frameLike> => Promise.resolve(frameLike),
    };
    const result = await executeDiscoverForm(config as unknown as ILoginConfig, ctx);
    const isOkResult34 = isOk(result);
    expect(isOkResult34).toBe(true);
  });

  it('handles empty submit config (array falsy path)', async () => {
    const makeScreenshotPageResult35 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult35);
    const configArrSubmit = {
      loginUrl: 'https://bank.example.com/login',
      fields: [
        {
          credentialKey: 'password',
          selectors: [{ kind: 'placeholder' as const, value: 'pwd' }],
        },
      ],
      submit: [],
      possibleResults: {},
    };
    const result = await executeDiscoverForm(configArrSubmit as unknown as ILoginConfig, ctx);
    const isOkResult36 = isOk(result);
    expect(isOkResult36).toBe(true);
  });

  it('discovers with multiple fields (password + username)', async () => {
    const makeScreenshotPageResult37 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult37);
    const cfg = {
      loginUrl: 'https://bank.example.com/login',
      fields: [
        {
          credentialKey: 'username',
          selectors: [{ kind: 'placeholder' as const, value: 'user' }],
        },
        {
          credentialKey: 'password',
          selectors: [{ kind: 'placeholder' as const, value: 'pwd' }],
        },
      ],
      submit: [{ kind: 'textContent' as const, value: 'Login' }],
      possibleResults: {},
    };
    const result = await executeDiscoverForm(cfg as unknown as ILoginConfig, ctx);
    const isOkResult38 = isOk(result);
    expect(isOkResult38).toBe(true);
  });
});
