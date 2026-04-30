/**
 * Unit tests for LoginPhaseActions — PRE/ACTION/POST/FINAL orchestration.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { IFormErrorScanResult } from '../../../../Scrapers/Pipeline/Mediator/Form/FormErrorDiscovery.js';
import {
  executeDiscoverForm,
  executeFillAndSubmitFromDiscovery,
  executeValidateLogin,
} from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { ILoginFieldDiscovery } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeContextWithLogin,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockActionExecutor, makeScreenshotPage, toActionCtx } from './TestHelpers.js';

/** Minimal ILoginConfig. */
const TEST_CONFIG = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent' as const, value: 'Login' },
  possibleResults: {},
};

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

describe('executeDiscoverForm', () => {
  it('fails when browser missing', async () => {
    const ctx = makeMockContext();
    const result = await executeDiscoverForm(TEST_CONFIG as unknown as ILoginConfig, ctx);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(false);
  });

  it('fails when mediator missing but browser present', async () => {
    const makeScreenshotPageResult2 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult2);
    const noMed = { ...ctx, mediator: none() };
    const result = await executeDiscoverForm(TEST_CONFIG as unknown as ILoginConfig, noMed);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(false);
  });

  it('fails when checkReadiness throws', async () => {
    const makeScreenshotPageResult4 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult4);
    const config = {
      ...TEST_CONFIG,
      /**
       * Throws to simulate readiness failure.
       * @returns Rejected.
       */
      checkReadiness: (): Promise<never> => Promise.reject(new Error('not ready')),
    };
    const result = await executeDiscoverForm(config as unknown as ILoginConfig, ctx);
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(false);
  });

  it('succeeds with empty fields config', async () => {
    const makeScreenshotPageResult6 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult6);
    const result = await executeDiscoverForm(TEST_CONFIG as unknown as ILoginConfig, ctx);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });

  it('fails when preAction throws', async () => {
    const makeScreenshotPageResult8 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult8);
    const config = {
      ...TEST_CONFIG,
      /**
       * Throws to simulate preAction failure.
       * @returns Rejected.
       */
      preAction: (): Promise<never> => Promise.reject(new Error('preAction crash')),
    };
    const result = await executeDiscoverForm(config as unknown as ILoginConfig, ctx);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(false);
  });

  it('runs preAction successfully when defined', async () => {
    const makeScreenshotPageResult10 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult10);
    const config = {
      ...TEST_CONFIG,
      /**
       * Returns void/undefined for active frame fallback.
       * @returns Undefined.
       */
      preAction: (): Promise<undefined> => Promise.resolve(undefined),
    };
    const result = await executeDiscoverForm(config as unknown as ILoginConfig, ctx);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
  });

  it('runs checkReadiness successfully when defined', async () => {
    const makeScreenshotPageResult12 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult12);
    const config = {
      ...TEST_CONFIG,
      /**
       * No-op readiness check.
       * @returns Resolved void.
       */
      checkReadiness: (): Promise<void> => Promise.resolve(),
    };
    const result = await executeDiscoverForm(config as unknown as ILoginConfig, ctx);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
  });

  it('discovers fields when fields config present', async () => {
    const makeScreenshotPageResult14 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult14);
    const result = await executeDiscoverForm(CONFIG_WITH_FIELDS as unknown as ILoginConfig, ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(true);
    if (isOk(result)) {
      expect(result.value.loginFieldDiscovery.has).toBe(true);
    }
  });
});

describe('executeFillAndSubmitFromDiscovery', () => {
  it('fails when loginAreaReady is false', async () => {
    const makeMockActionExecutorResult17 = makeMockActionExecutor();
    const makeMockContextResult16 = makeMockContext();
    const ctx = toActionCtx(makeMockContextResult16, makeMockActionExecutorResult17);
    const result = await executeFillAndSubmitFromDiscovery(
      TEST_CONFIG as unknown as ILoginConfig,
      ctx,
    );
    const isOkResult18 = isOk(result);
    expect(isOkResult18).toBe(false);
  });

  it('fails when no loginFieldDiscovery', async () => {
    const base = makeMockContext({ loginAreaReady: true });
    const makeMockActionExecutorResult19 = makeMockActionExecutor();
    const ctx = toActionCtx(base, makeMockActionExecutorResult19);
    const result = await executeFillAndSubmitFromDiscovery(
      TEST_CONFIG as unknown as ILoginConfig,
      ctx,
    );
    const isOkResult20 = isOk(result);
    expect(isOkResult20).toBe(false);
  });

  it('fails when no executor', async () => {
    const disc: ILoginFieldDiscovery = {
      targets: new Map(),
      formAnchor: none(),
      activeFrameId: 'main',
      submitTarget: none(),
    };
    const base = makeMockContext({
      loginAreaReady: true,
      loginFieldDiscovery: some(disc),
    });
    const ctx = toActionCtx(base, false);
    const result = await executeFillAndSubmitFromDiscovery(
      TEST_CONFIG as unknown as ILoginConfig,
      ctx,
    );
    const isOkResult21 = isOk(result);
    expect(isOkResult21).toBe(false);
  });
});

describe('executeValidateLogin', () => {
  it('fails when no login state', async () => {
    const mediator = makeMockMediator();
    const ctx = makeMockContext();
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult22 = isOk(result);
    expect(isOkResult22).toBe(false);
  });

  it('fails when no browser', async () => {
    const mediator = makeMockMediator();
    const makeScreenshotPageResult23 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult23);
    const noBrowser = { ...ctx, browser: none() };
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      noBrowser,
    );
    const isOkResult24 = isOk(result);
    expect(isOkResult24).toBe(false);
  });

  it('fails when form errors detected', async () => {
    const errorResult: IFormErrorScanResult = {
      hasErrors: true,
      errors: [],
      summary: 'Invalid password',
    };
    const mediator = makeMockMediator({
      /**
       * Return error scan result.
       * @returns Form errors.
       */
      discoverErrors: () => Promise.resolve(errorResult),
    });
    const makeScreenshotPageResult25 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult25);
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult26 = isOk(result);
    expect(isOkResult26).toBe(false);
  });

  it('succeeds when no errors + traffic wait resolves', async () => {
    const mediator = makeMockMediator();
    const makeScreenshotPageResult27 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult27);
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult28 = isOk(result);
    expect(isOkResult28).toBe(true);
  });

  it('runs postAction callback when defined', async () => {
    const mediator = makeMockMediator();
    const makeScreenshotPageResult29 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult29);
    const cbConfig = {
      ...TEST_CONFIG,
      /**
       * Run a no-op post callback.
       * @returns Success promise.
       */
      postAction: (): Promise<true> => Promise.resolve(true),
    };
    const result = await executeValidateLogin(cbConfig as unknown as ILoginConfig, mediator, ctx);
    const isOkResult30 = isOk(result);
    expect(isOkResult30).toBe(true);
  });

  it('fails when waitForLoadingDone fails', async () => {
    const { fail: failFn } = await import('../../../../Scrapers/Pipeline/Types/Procedure.js');
    const mediator = makeMockMediator({
      /**
       * Return fail to simulate spinner stuck.
       * @returns Failure.
       */
      waitForLoadingDone: () => {
        const failResult = failFn(ScraperErrorTypes.Generic, 'still loading');
        return Promise.resolve(failResult);
      },
    });
    const makeScreenshotPageResult31 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult31);
    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );
    const isOkResult32 = isOk(result);
    expect(isOkResult32).toBe(false);
  });
});

// Field-discovery path tests split to LoginPhaseActionsFieldDiscovery.test.ts

// ── Deep coverage: resolveOneField SUCCESS + submit discovery ───────
