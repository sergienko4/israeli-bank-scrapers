/**
 * M2.T10 — cross-bank factory test for the LOGIN phase.
 *
 * <p>One logic path, parametrized over every browser-flow bank that
 * runs the LOGIN phase. Mirrors the {@link AuthDiscoveryFactoryTest}
 * shape: a `BANK_LOGIN_FIXTURES` table (in `BankLoginFixtures.ts`)
 * drives `describe.each` for the bank-shape contracts (config +
 * pipeline phase sequence), and a separate set of bank-agnostic
 * blocks exercises the LOGIN action handlers
 * (`executeDiscoverForm`, `executeFillAndSubmitFromDiscovery`,
 * `executeValidateLogin`, `validateActionScopeIntact`, plus the
 * auth-API short-circuit) using a generic mock config that any
 * production bank's config could swap in for.
 *
 * <p>Coverage absorbed from (deleted by this PR):
 * `LoginPhaseActions(.test|Branches|Deep|FieldDiscovery|Redirect|ScopeIntact|Wave5).test.ts`,
 * `Bank/Discount/Login/DiscountLogin.test.ts`,
 * `Bank/VisaCal/Login/VisaCalLogin.test.ts`. Coverage threshold
 * (97/95/97/98) is preserved — every cross-bank scenario folded
 * into one of the blocks below.
 *
 * <p>FAKE-but-real-bank-shape data: each fixture row reuses the
 * production `*_LOGIN` config and `build*Pipeline` builder.
 * Per-bank stubs (mediator / page) carry only fake values; URLs
 * use `.example` reserved TLDs.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import {
  executeDiscoverForm,
  executeFillAndSubmitFromDiscovery,
  executeValidateLogin,
} from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
import type {
  AuthFailureClassifier,
  IAuthFailure,
  IAuthFailureWatcher,
} from '../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher.js';
import type { INetworkDiscovery } from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  ILoginFieldDiscovery,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail, isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithBrowser,
  makeContextWithLogin,
  makeMockContext,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { BANK_LOGIN_FIXTURES } from './BankLoginFixtures.js';
import { makeMockActionExecutor, makeScreenshotPage, toActionCtx } from './TestHelpers.js';

/**
 * Build a {@link ScraperOptions} stub for the bank's pipeline
 * builder. Uses fake credentials and `companyId` to satisfy the
 * builder's options validation.
 *
 * @param company - Bank under test.
 * @returns Mock options bound to the company.
 */
function makeOpts(company: string): ScraperOptions {
  return { companyId: company } as unknown as ScraperOptions;
}

// ─── Cross-bank LOGIN-shape contract ─────────────────────────────

describe.each(BANK_LOGIN_FIXTURES)('$bank — LOGIN config + pipeline shape', fixture => {
  it('declares the expected credential field keys', () => {
    const keys = fixture.loginConfig.fields.map((f): string => f.credentialKey);
    expect(keys).toEqual(fixture.expectedFieldKeys);
  });

  it('declares an empty submit (mediator resolves at runtime)', () => {
    const submit = Array.isArray(fixture.loginConfig.submit)
      ? fixture.loginConfig.submit
      : [fixture.loginConfig.submit];
    expect(submit.length).toBe(0);
  });

  it.each([['checkReadiness'], ['preAction'], ['postAction']])(
    'has no legacy %s callback (declarative shape)',
    key => {
      const cfg = fixture.loginConfig as unknown as Record<string, unknown>;
      expect(cfg[key]).toBeUndefined();
    },
  );

  it('builds a pipeline descriptor with the expected phase count', () => {
    const opts = makeOpts(fixture.company);
    const result = fixture.buildPipeline(opts);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.phases).toHaveLength(fixture.expectedPhaseCount);
  });

  it('builds a pipeline descriptor with the expected phase name sequence', () => {
    const opts = makeOpts(fixture.company);
    const result = fixture.buildPipeline(opts);
    expect(result.success).toBe(true);
    if (result.success) {
      const names = result.value.phases.map((p): string => p.name);
      expect(names).toEqual(fixture.expectedPhaseNames);
    }
  });
});

// ─── Bank-agnostic LOGIN action handlers ─────────────────────────

/** Generic mock config — every assertion below holds regardless of bank. */
const TEST_CONFIG = {
  loginUrl: 'https://bank.example.com/login',
  fields: [],
  submit: { kind: 'textContent' as const, value: 'Login' },
  possibleResults: {},
} as unknown as ILoginConfig;

const CONFIG_WITH_FIELDS = {
  loginUrl: 'https://bank.example.com/login',
  fields: [
    { credentialKey: 'password', selectors: [{ kind: 'placeholder' as const, value: 'pwd' }] },
  ],
  submit: [{ kind: 'textContent' as const, value: 'Login' }],
  possibleResults: {},
} as unknown as ILoginConfig;

describe('executeDiscoverForm — pre-condition guards', () => {
  it('fails when browser is missing', async () => {
    const ctx = makeMockContext();
    const result = await executeDiscoverForm(TEST_CONFIG, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('fails when mediator is missing but browser is present', async () => {
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const noMed = { ...ctx, mediator: none() };
    const result = await executeDiscoverForm(TEST_CONFIG, noMed);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });
});

/**
 * Throws to simulate readiness failure.
 *
 * @returns Rejected promise.
 */
const CHECK_READINESS_THROWS = (): Promise<never> => Promise.reject(new Error('not ready'));

/**
 * Throws to simulate preAction failure.
 *
 * @returns Rejected promise.
 */
const PRE_ACTION_THROWS = (): Promise<never> => Promise.reject(new Error('preAction crash'));

/**
 * No-op readiness check.
 *
 * @returns Resolved void.
 */
const CHECK_READINESS_OK = (): Promise<void> => Promise.resolve();

/**
 * preAction returning undefined → page fallback.
 *
 * @returns Undefined.
 */
const PRE_ACTION_PAGE_FALLBACK = (): Promise<undefined> => Promise.resolve(undefined);

describe('executeDiscoverForm — checkReadiness + preAction callback paths', () => {
  it.each([
    ['checkReadiness throws → fail', { checkReadiness: CHECK_READINESS_THROWS }, false],
    ['preAction throws → fail', { preAction: PRE_ACTION_THROWS }, false],
    ['checkReadiness resolves → success', { checkReadiness: CHECK_READINESS_OK }, true],
    [
      'preAction resolves undefined (page fallback) → success',
      { preAction: PRE_ACTION_PAGE_FALLBACK },
      true,
    ],
  ])('%s', async (_label, override, expectOk) => {
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const cfg = { ...TEST_CONFIG, ...override } as unknown as ILoginConfig;
    const result = await executeDiscoverForm(cfg, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(expectOk);
  });

  it('succeeds with empty fields config', async () => {
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const result = await executeDiscoverForm(TEST_CONFIG, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('discovers fields when fields config present', async () => {
    const page = makeScreenshotPage();
    const ctx = makeContextWithBrowser(page);
    const result = await executeDiscoverForm(CONFIG_WITH_FIELDS, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (wasOk) expect(result.value.loginFieldDiscovery.has).toBe(true);
  });
});

describe('executeFillAndSubmitFromDiscovery — pre-condition guards', () => {
  it('fails when loginAreaReady is false', async () => {
    const exec = makeMockActionExecutor();
    const baseCtx = makeMockContext();
    const ctx = toActionCtx(baseCtx, exec);
    const result = await executeFillAndSubmitFromDiscovery(TEST_CONFIG, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('fails when no loginFieldDiscovery is set', async () => {
    const base = makeMockContext({ loginAreaReady: true });
    const exec = makeMockActionExecutor();
    const ctx = toActionCtx(base, exec);
    const result = await executeFillAndSubmitFromDiscovery(TEST_CONFIG, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('fails when no executor is wired', async () => {
    const disc: ILoginFieldDiscovery = {
      targets: new Map(),
      formAnchor: none(),
      activeFrameId: 'main',
      submitTarget: none(),
    };
    const base = makeMockContext({ loginAreaReady: true, loginFieldDiscovery: some(disc) });
    const ctx = toActionCtx(base, false);
    const result = await executeFillAndSubmitFromDiscovery(TEST_CONFIG, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });
});

/**
 * Build a no-login-state context.
 *
 * @returns Mock pipeline context with no login state.
 */
const BUILD_NO_LOGIN = (): IPipelineContext => makeMockContext();

/**
 * Build a login-state context with browser stripped.
 *
 * @returns Pipeline context whose `browser` is none().
 */
const BUILD_NO_BROWSER = (): IPipelineContext => {
  const page = makeScreenshotPage();
  const baseCtx = makeContextWithLogin(page);
  return { ...baseCtx, browser: none() };
};

describe('executeValidateLogin — pre-condition + traffic guards', () => {
  it.each([
    ['no login state', BUILD_NO_LOGIN],
    ['no browser', BUILD_NO_BROWSER],
  ])('fails when %s', async (_label, builder) => {
    const mediator = makeMockMediator();
    const ctx = builder();
    const result = await executeValidateLogin(TEST_CONFIG, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });

  it('succeeds on the happy path (no errors, traffic settled)', async () => {
    const page = makeScreenshotPage();
    const ctx = makeContextWithLogin(page);
    const mediator = makeMockMediator();
    const result = await executeValidateLogin(TEST_CONFIG, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('runs postAction callback when defined', async () => {
    /**
     * No-op post-action.
     *
     * @returns Resolved true.
     */
    const postAction = (): Promise<true> => Promise.resolve(true);
    const cfg = { ...TEST_CONFIG, postAction } as unknown as ILoginConfig;
    const page = makeScreenshotPage();
    const ctx = makeContextWithLogin(page);
    const mediator = makeMockMediator();
    const result = await executeValidateLogin(cfg, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('fails when waitForLoadingDone returns failure', async () => {
    const stuckSpinnerFailure = fail(ScraperErrorTypes.Generic, 'still loading');
    const mediator = makeMockMediator({
      /**
       * Stub loading wait — emit a fail Procedure.
       *
       * @returns Failure procedure.
       */
      waitForLoadingDone: () => Promise.resolve(stuckSpinnerFailure),
    });
    const page = makeScreenshotPage();
    const ctx = makeContextWithLogin(page);
    const result = await executeValidateLogin(TEST_CONFIG, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
  });
});

// ─── validateActionScopeIntact (M2 fail-loud signal) ─────────────

const LOGIN_URL = 'https://bank.example.com/login';
const TEST_CONFIG_LOGIN_URL: ILoginConfig = { ...TEST_CONFIG, loginUrl: LOGIN_URL };

/**
 * Build a single-target login-field discovery with a password
 * selector — the only field {@link executeValidateLogin}'s scope-
 * intact probe consults.
 *
 * @param passwordSelector - Selector recorded by login.PRE.
 * @returns Discovery carrying just the password target.
 */
function makeDiscoveryWithPassword(passwordSelector: string): ILoginFieldDiscovery {
  return {
    targets: new Map([
      [
        'password',
        {
          selector: passwordSelector,
          contextId: 'main',
          kind: 'placeholder',
          candidateValue: 'pwd',
        },
      ],
    ]),
    formAnchor: none(),
    activeFrameId: 'main',
    submitTarget: none(),
  };
}

/**
 * Build a login-field discovery whose targets map carries no
 * password — exercises the early-return branch.
 *
 * @returns Discovery without a password target.
 */
function makeDiscoveryNoPassword(): ILoginFieldDiscovery {
  return { targets: new Map(), formAnchor: none(), activeFrameId: 'main', submitTarget: none() };
}

/** Args for {@link buildScopeCtx}. */
interface IBuildScopeCtxArgs {
  readonly mediator: ReturnType<typeof makeMockMediator>;
  readonly discovery: ILoginFieldDiscovery | false;
  readonly loginUrl?: string;
}

/**
 * Build a pipeline context with login state, optional discovery,
 * and `diagnostics.loginUrl` matching the URL the mediator's
 * `getCurrentUrl` returns.
 *
 * @param args - Mediator + discovery + optional loginUrl override.
 * @returns Pipeline context wired in.
 */
function buildScopeCtx(args: IBuildScopeCtxArgs): IPipelineContext {
  const page = makeScreenshotPage();
  const baseCtx = makeContextWithLogin(page);
  const url = args.loginUrl ?? LOGIN_URL;
  const ctxWithUrl: IPipelineContext = {
    ...baseCtx,
    diagnostics: { ...baseCtx.diagnostics, loginUrl: url },
    mediator: some(args.mediator),
  };
  if (args.discovery === false) return ctxWithUrl;
  return { ...ctxWithUrl, loginFieldDiscovery: some(args.discovery) };
}

describe('validateActionScopeIntact — URL guard + form probe matrix', () => {
  it('skips probe and succeeds when URL has redirected off the login pathname', async () => {
    let probeCount = 0;
    /**
     * Records every probe — must stay 0 when URL guard fires.
     *
     * @returns 1 (would fail-loud if URL guard let probe run).
     */
    const countBySelector = (): Promise<number> => {
      probeCount += 1;
      return Promise.resolve(1);
    };
    /**
     * Mock URL — page redirected to OTP step.
     *
     * @returns OTP screen URL.
     */
    const getCurrentUrl = (): string => 'https://bank.example.com/otp';
    const mediator = makeMockMediator({ countBySelector, getCurrentUrl });
    const ctx = buildScopeCtx({ mediator, discovery: makeDiscoveryWithPassword('#password') });
    const result = await executeValidateLogin(TEST_CONFIG_LOGIN_URL, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    expect(probeCount).toBe(0);
  });

  it('fails LOUD with InvalidPassword when URL unchanged AND password element persists', async () => {
    let probedSelector = '';
    /**
     * Records the probed selector.
     *
     * @param selector - Probed selector.
     * @returns 1 (form still mounted).
     */
    const countBySelector = (selector: string): Promise<number> => {
      probedSelector = selector;
      return Promise.resolve(1);
    };
    /**
     * Mock URL — never moved.
     *
     * @returns The login URL.
     */
    const getCurrentUrl = (): string => LOGIN_URL;
    const mediator = makeMockMediator({ countBySelector, getCurrentUrl });
    const ctx = buildScopeCtx({ mediator, discovery: makeDiscoveryWithPassword('#password') });
    const result = await executeValidateLogin(TEST_CONFIG_LOGIN_URL, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!wasOk) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(probedSelector).toBe('#password');
  });

  /**
   * Stubbed URL accessor that returns the login URL.
   *
   * @returns The login URL.
   */
  const sameUrl = (): string => LOGIN_URL;
  /**
   * Stubbed counter that always reports 0 (form gone).
   *
   * @returns 0.
   */
  const countZero = (): Promise<number> => Promise.resolve(0);
  /**
   * Stubbed counter that always reports 1 (form present).
   *
   * @returns 1.
   */
  const countOne = (): Promise<number> => Promise.resolve(1);

  it.each([
    [
      'count drops to 0 (form destroyed)',
      { countBySelector: countZero, getCurrentUrl: sameUrl },
      makeDiscoveryWithPassword('#password'),
    ],
    [
      'no login-field discovery (HOME-skipped paths)',
      { countBySelector: countOne, getCurrentUrl: sameUrl },
      false as const,
    ],
    [
      'discovery has no password target',
      { countBySelector: countOne, getCurrentUrl: sameUrl },
      makeDiscoveryNoPassword(),
    ],
  ])('skips probe and succeeds: %s', async (_label, mediatorOverride, discovery) => {
    const mediator = makeMockMediator(mediatorOverride);
    const ctx = buildScopeCtx({ mediator, discovery });
    const result = await executeValidateLogin(TEST_CONFIG_LOGIN_URL, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('treats empty diagnostics.loginUrl as "still on login URL"', async () => {
    /**
     * Form present.
     *
     * @returns 1.
     */
    const countBySelector = (): Promise<number> => Promise.resolve(1);
    /**
     * Any URL — empty `loginUrl` short-circuits before comparison.
     *
     * @returns Some URL.
     */
    const getCurrentUrl = (): string => 'about:blank';
    const mediator = makeMockMediator({ countBySelector, getCurrentUrl });
    const ctx = buildScopeCtx({
      mediator,
      discovery: makeDiscoveryWithPassword('#password'),
      loginUrl: '',
    });
    const result = await executeValidateLogin(TEST_CONFIG_LOGIN_URL, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!wasOk) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });
});

// ─── Auth-API failure short-circuit (M2 watcher) ─────────────────

/**
 * Build a stub auth-failure watcher pre-loaded with one captured
 * failure — exercises `detectAuthApiFailure`'s captured-truthy
 * branch and the `??` fallback inside
 * `AUTH_FAILURE_LAYER_LABELS[captured.classifier]`.
 *
 * @param classifier - Layer that fired ('http-4xx' or 'body-error').
 * @returns Watcher whose `hasFailed` returns the captured payload.
 */
function makeFiredAuthWatcher(classifier: AuthFailureClassifier): IAuthFailureWatcher {
  const captured: IAuthFailure = {
    status: 401,
    url: 'https://bank.example.com/api/auth/login',
    bodyPreview: 'invalid_credentials',
    classifier,
  };
  /**
   * Async probe.
   *
   * @returns Captured failure.
   */
  const waitForFailure = (): Promise<IAuthFailure | false> => Promise.resolve(captured);
  /**
   * Synchronous probe.
   *
   * @returns Captured failure.
   */
  const hasFailed = (): IAuthFailure | false => captured;
  /**
   * No-op reset — these tests never replay across attempts.
   *
   * @returns True.
   */
  const reset = (): boolean => true;
  /**
   * No-op dispose — these tests never tear down listeners.
   *
   * @returns True.
   */
  const dispose = (): boolean => true;
  return { waitForFailure, hasFailed, reset, dispose };
}

/**
 * Wrap a base mediator with a custom auth-failure watcher attached
 * to its `network` surface.
 *
 * @param base - Mediator returned by `makeMockMediator`.
 * @param watcher - Auth-failure watcher to attach.
 * @returns Mediator with watcher override applied.
 */
function withAuthWatcher(
  base: ReturnType<typeof makeMockMediator>,
  watcher: IAuthFailureWatcher,
): ReturnType<typeof makeMockMediator> {
  const networkOverride: INetworkDiscovery = { ...base.network, authFailureWatcher: watcher };
  return makeMockMediator({ ...base, network: networkOverride });
}

describe('executeValidateLogin — detectAuthApiFailure short-circuit', () => {
  /**
   * Mock URL — same as login URL.
   *
   * @returns Login URL.
   */
  const sameUrl = (): string => LOGIN_URL;

  it.each<['http-4xx' | 'body-error']>([['http-4xx'], ['body-error']])(
    'fails LOUD with InvalidPassword when watcher reports a %s hit',
    async classifier => {
      const baseMediator = makeMockMediator({ getCurrentUrl: sameUrl });
      const watcher = makeFiredAuthWatcher(classifier);
      const mediator = withAuthWatcher(baseMediator, watcher);
      const discovery = makeDiscoveryWithPassword('#password');
      const ctx = buildScopeCtx({ mediator, discovery });
      const result = await executeValidateLogin(TEST_CONFIG_LOGIN_URL, mediator, ctx);
      const wasOk = isOk(result);
      expect(wasOk).toBe(false);
      if (!wasOk) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    },
  );
});

// ─── URL bounce / path equivalence (Wave5 / Redirect coverage) ───

describe('executeValidateLogin — URL pathname comparisons', () => {
  it.each([
    ['exact same login URL (Amex SPA pattern) → success', LOGIN_URL, true],
    ['login URL + trailing # → success', `${LOGIN_URL}#`, true],
    ['unparseable URL pair → success (raw-fallback)', 'also-not-valid', true],
    [
      'off-login dashboard URL → success (path bounce away)',
      'https://bank.example.com/dashboard',
      true,
    ],
  ])('%s', async (_label, currentUrl, expectOk) => {
    /**
     * Mock URL fixture per row.
     *
     * @returns Current URL.
     */
    const getCurrentUrl = (): string => currentUrl;
    const mediator = makeMockMediator({ getCurrentUrl });
    const page = makeScreenshotPage();
    const baseCtx = makeContextWithLogin(page);
    const ctx: IPipelineContext = {
      ...baseCtx,
      diagnostics: { ...baseCtx.diagnostics, loginUrl: LOGIN_URL },
    };
    const result = await executeValidateLogin(TEST_CONFIG_LOGIN_URL, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(expectOk);
  });

  it('fails InvalidPassword when post-submit URL keeps login path but adds query (Max bounce)', async () => {
    const bouncedUrl = 'https://bank.example.com/login?ReturnURL=%2Fdashboard';
    /**
     * Mock URL — query bounce on login path.
     *
     * @returns Bounced URL.
     */
    const getCurrentUrl = (): string => bouncedUrl;
    const mediator = makeMockMediator({ getCurrentUrl });
    const page = makeScreenshotPage();
    const baseCtx = makeContextWithLogin(page);
    const ctx: IPipelineContext = {
      ...baseCtx,
      diagnostics: { ...baseCtx.diagnostics, loginUrl: LOGIN_URL },
    };
    const result = await executeValidateLogin(TEST_CONFIG_LOGIN_URL, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!wasOk) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('skips bounce detection when loginUrl is empty', async () => {
    /**
     * Mock URL — same as login URL.
     *
     * @returns Login URL.
     */
    const getCurrentUrl = (): string => LOGIN_URL;
    const mediator = makeMockMediator({ getCurrentUrl });
    const page = makeScreenshotPage();
    const baseCtx = makeContextWithLogin(page);
    const ctx: IPipelineContext = {
      ...baseCtx,
      diagnostics: { ...baseCtx.diagnostics, loginUrl: '' },
    };
    const result = await executeValidateLogin(TEST_CONFIG_LOGIN_URL, mediator, ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});

// Deep submit + field-resolution branch coverage lives in
// `LoginFactoryDeepCoverage.test.ts` — same factory pattern,
// separate file so each stays under the per-file `max-lines`
// ceiling. The split is mechanical, not architectural: both files
// drive the same `BANK_LOGIN_FIXTURES` table and exercise the same
// production handler surface.
