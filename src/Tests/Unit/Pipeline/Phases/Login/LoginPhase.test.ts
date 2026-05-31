/**
 * Unit tests for Phases/Login/LoginPhase — factory + name guarantee.
 */

import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import {
  createLoginPhaseFromConfig,
  LoginPhase,
} from '../../../../../Scrapers/Pipeline/Phases/Login/LoginPhase.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { ILoginFieldDiscovery } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeContextWithLogin,
  makeMockContext,
} from '../../../Scrapers/Pipeline/MockPipelineFactories.js';
import {
  makeMockActionExecutor,
  makeScreenshotPage,
  toActionCtx,
} from '../../Infrastructure/TestHelpers.js';

/** Minimal login config. */
const MIN_CONFIG: ILoginConfig = {
  loginUrl: 'https://example.com',
  fields: [{ credentialKey: 'username', selectors: [] }],
  submit: [],
  possibleResults: { success: [] },
};

describe('createLoginPhaseFromConfig', () => {
  it('returns a LoginPhase instance', () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    expect(phase).toBeInstanceOf(LoginPhase);
  });

  it('has name "login"', () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    expect(phase.name).toBe('login');
  });

  it('creates distinct instances per factory call', () => {
    const a = createLoginPhaseFromConfig(MIN_CONFIG);
    const b = createLoginPhaseFromConfig(MIN_CONFIG);
    expect(a).not.toBe(b);
  });
});

describe('LoginPhase.pre() / action() / post() / final()', () => {
  it('pre() succeeds when browser + mediator present', async () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const makeScreenshotPageResult1 = makeScreenshotPage();
    const ctx = makeContextWithBrowser(makeScreenshotPageResult1);
    const result = await phase.pre(ctx, ctx);
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('pre() fails when no browser', async () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const ctx = makeMockContext();
    const result = await phase.pre(ctx, ctx);
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(false);
  });

  it('action() fails when loginAreaReady=false', async () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const makeMockActionExecutorResult5 = makeMockActionExecutor();
    const makeMockContextResult4 = makeMockContext();
    const actionCtx = toActionCtx(makeMockContextResult4, makeMockActionExecutorResult5);
    const result = await phase.action(actionCtx, actionCtx);
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(false);
  });

  it('action() fails when no loginFieldDiscovery', async () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const base = makeMockContext({ loginAreaReady: true });
    const makeMockActionExecutorResult7 = makeMockActionExecutor();
    const actionCtx = toActionCtx(base, makeMockActionExecutorResult7);
    const result = await phase.action(actionCtx, actionCtx);
    const isOkResult8 = isOk(result);
    expect(isOkResult8).toBe(false);
  });

  it('post() fails when mediator missing', async () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const ctx = makeMockContext();
    const noMed = { ...ctx, mediator: none() };
    const result = await phase.post(ctx, noMed);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(false);
  });

  it('post() succeeds when mediator + login state + browser present', async () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const makeScreenshotPageResult10 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult10);
    const result = await phase.post(ctx, ctx);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(true);
  });

  it('final() produces a result (executeLoginSignal)', async () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const makeScreenshotPageResult12 = makeScreenshotPage();
    const ctx = makeContextWithLogin(makeScreenshotPageResult12);
    const result = await phase.final(ctx, ctx);
    expect(typeof result.success).toBe('boolean');
  });
});

describe('LoginPhase.validatePrePayload', () => {
  it('returns true when loginFieldDiscovery is absent (L86 true branch)', () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const ctx = makeMockContext(); // no loginFieldDiscovery
    // Access protected via unknown cast for unit coverage
    const fn = (
      phase as unknown as { validatePrePayload: (c: unknown) => boolean }
    ).validatePrePayload.bind(phase);
    const isValid13 = fn(ctx);
    expect(isValid13).toBe(true);
  });

  it('returns true when loginFieldDiscovery present (L86 false branch)', () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const base = makeMockContext();
    const ctx = { ...base, loginFieldDiscovery: some({} as unknown as ILoginFieldDiscovery) };
    const fn = (
      phase as unknown as { validatePrePayload: (c: unknown) => boolean }
    ).validatePrePayload.bind(phase);
    const isValid14 = fn(ctx);
    expect(isValid14).toBe(true);
  });
});

describe('LoginPhase.run() orchestration via BasePhase', () => {
  it('fails run() when browser missing (PRE fails)', async () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const ctx = makeMockContext();
    const result = await phase.run(ctx);
    const isOkResult15 = isOk(result);
    expect(isOkResult15).toBe(false);
  });

  it('fails run() when mediator missing (PRE fails)', async () => {
    const phase = createLoginPhaseFromConfig(MIN_CONFIG);
    const makeScreenshotPageResult16 = makeScreenshotPage();
    const base = makeContextWithBrowser(makeScreenshotPageResult16);
    const ctx = {
      ...base,
      mediator: none(),
      loginFieldDiscovery: some({} as unknown as ILoginFieldDiscovery),
    };
    const result = await phase.run(ctx);
    const isOkResult17 = isOk(result);
    expect(isOkResult17).toBe(false);
  });
});
