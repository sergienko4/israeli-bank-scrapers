/**
 * Mission 2 — coverage for `validateActionScopeIntact`, the M2
 * replacement for the deleted `detectLoginFormStillPresent` poll.
 *
 * <p>Behaviour under test (exercised through the public
 * `executeValidateLogin` entry point):
 * <ul>
 *   <li>URL has changed off the login pathname → skip (return false,
 *       executeValidateLogin succeeds). This is the Hapoalim CI fix:
 *       OTP screen retains both `#password` and `#userCode`, so a
 *       form-presence probe alone would false-positive InvalidPassword
 *       on every device-remembered login.</li>
 *   <li>URL still on login pathname AND password element still in DOM
 *       → fail loud with InvalidPassword. The genuine bad-credentials
 *       signal — Hapoalim gate test continues to rely on this.</li>
 *   <li>URL still on login pathname AND password element absent → skip
 *       (login form was destroyed by a successful submit).</li>
 *   <li>No login-field discovery in context (HOME-skipped paths) →
 *       skip; nothing to probe.</li>
 *   <li>Discovery present but no password target (atypical config) →
 *       skip; cannot probe.</li>
 * </ul>
 *
 * <p>Mocks: a thin `countBySelector` stub records the probed selector;
 * `getCurrentUrl` is overridden when the URL-changed branch is being
 * exercised.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { executeValidateLogin } from '../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
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
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithLogin,
  makeMockMediator,
} from '../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeScreenshotPage } from './TestHelpers.js';

/** Login URL the regression scenarios stay on / leave. */
const LOGIN_URL = 'https://bank.example.com/login';

/** Minimal `ILoginConfig` shared across the regressions below. */
const TEST_CONFIG = {
  loginUrl: LOGIN_URL,
  fields: [],
  submit: { kind: 'textContent' as const, value: 'Login' },
  possibleResults: {},
};

/**
 * Build a minimal `ILoginFieldDiscovery` carrying a single password
 * target — the only field `validateActionScopeIntact` consults.
 *
 * @param passwordSelector - Selector recorded by login.PRE.
 * @returns Discovery with only a password target.
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
 * Build a discovery with NO password target — exercises the
 * `passwordTarget` early-return branch in `validateActionScopeIntact`.
 *
 * @returns Discovery without a password.
 */
function makeDiscoveryNoPassword(): ILoginFieldDiscovery {
  return {
    targets: new Map(),
    formAnchor: none(),
    activeFrameId: 'main',
    submitTarget: none(),
  };
}

/**
 * Args bundle for {@link buildCtx} — keeps the call site short and
 * keeps the function-signature line count under the project's
 * per-function param budget.
 */
interface IBuildCtxArgs {
  readonly mediator: ReturnType<typeof makeMockMediator>;
  readonly discovery: ILoginFieldDiscovery | false;
  readonly loginUrl?: string;
}

/**
 * Build a pipeline context with the login state, optional discovery,
 * and a `diagnostics.loginUrl` matching the URL the mediator's
 * `getCurrentUrl` returns. The default `LOGIN_URL` keeps the URL
 * guard satisfied (= "still on login URL"); pass an empty string to
 * trigger the empty-loginUrl branch.
 *
 * @param args - Mediator + discovery + optional loginUrl.
 * @returns Pipeline context wired in.
 */
function buildCtx(args: IBuildCtxArgs): IPipelineContext {
  const page = makeScreenshotPage();
  const baseCtx = makeContextWithLogin(page);
  const loginUrl = args.loginUrl ?? LOGIN_URL;
  const ctxWithUrl: IPipelineContext = {
    ...baseCtx,
    diagnostics: { ...baseCtx.diagnostics, loginUrl },
    mediator: some(args.mediator),
  };
  if (args.discovery === false) return ctxWithUrl;
  return { ...ctxWithUrl, loginFieldDiscovery: some(args.discovery) };
}

describe('validateActionScopeIntact — URL guard skips the form probe when the page redirected', () => {
  it('returns success when the current URL has moved off the login pathname (Hapoalim OTP screen)', async () => {
    let probeCount = 0;
    /**
     * Records every probe — must stay 0 since the URL guard short-
     * circuits before any selector is counted.
     *
     * @returns 1 (would fail-loud if reached).
     */
    const countBySelector = (): Promise<number> => {
      probeCount += 1;
      return Promise.resolve(1);
    };
    const mediator = makeMockMediator({
      countBySelector,
      /**
       * URL has redirected to the OTP step — different pathname
       * from the recorded `LOGIN_URL`.
       *
       * @returns OTP screen URL.
       */
      getCurrentUrl: (): string => 'https://bank.example.com/otp',
    });
    const discovery = makeDiscoveryWithPassword('#password');
    const ctx = buildCtx({ mediator, discovery });

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    expect(probeCount).toBe(0);
  });
});

describe('validateActionScopeIntact — fails LOUD when scope intact + URL unchanged', () => {
  it('returns InvalidPassword when the login URL is unchanged AND the password element persists', async () => {
    let probedSelector = '';
    /**
     * The genuine invalid-creds path: SPA leaves the same login form
     * mounted and never bounces the URL.
     *
     * @param selector - Password selector being probed.
     * @returns 1 (form still present).
     */
    const countBySelector = (selector: string): Promise<number> => {
      probedSelector = selector;
      return Promise.resolve(1);
    };
    const mediator = makeMockMediator({
      countBySelector,
      /**
       * URL never moved — same as the recorded login URL.
       *
       * @returns The login URL.
       */
      getCurrentUrl: (): string => LOGIN_URL,
    });
    const discovery = makeDiscoveryWithPassword('#password');
    const ctx = buildCtx({ mediator, discovery });

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!wasOk) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
    expect(probedSelector).toBe('#password');
  });
});

describe('validateActionScopeIntact — succeeds when the form is destroyed', () => {
  it('returns success when the password element count drops to 0 (login form destroyed)', async () => {
    /**
     * Login form was unmounted by the SPA after a successful submit.
     *
     * @returns 0.
     */
    const countBySelector = (): Promise<number> => Promise.resolve(0);
    const mediator = makeMockMediator({
      countBySelector,
      /**
       * URL is unchanged but the form below is gone — common SPA path
       * where the URL has yet to settle but the view has flipped.
       *
       * @returns The login URL.
       */
      getCurrentUrl: (): string => LOGIN_URL,
    });
    const discovery = makeDiscoveryWithPassword('#password');
    const ctx = buildCtx({ mediator, discovery });

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});

describe('validateActionScopeIntact — early returns when there is nothing to probe', () => {
  it('returns success when the context has no login-field discovery (HOME-skipped paths)', async () => {
    let probeCount = 0;
    /**
     * Records the probe count — must stay 0 since the early return
     * short-circuits before counting.
     *
     * @returns 1.
     */
    const countBySelector = (): Promise<number> => {
      probeCount += 1;
      return Promise.resolve(1);
    };
    const mediator = makeMockMediator({
      countBySelector,
      /**
       * URL guard would otherwise allow probing.
       *
       * @returns The login URL.
       */
      getCurrentUrl: (): string => LOGIN_URL,
    });
    const ctx = buildCtx({ mediator, discovery: false });

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    expect(probeCount).toBe(0);
  });

  it('returns success when discovery is present but carries no password target', async () => {
    let probeCount = 0;
    /**
     * Records the probe count — must stay 0 since the password
     * target lookup misses and the function returns early.
     *
     * @returns 1.
     */
    const countBySelector = (): Promise<number> => {
      probeCount += 1;
      return Promise.resolve(1);
    };
    const mediator = makeMockMediator({
      countBySelector,
      /**
       * URL guard would otherwise allow probing.
       *
       * @returns The login URL.
       */
      getCurrentUrl: (): string => LOGIN_URL,
    });
    const discovery = makeDiscoveryNoPassword();
    const ctx = buildCtx({ mediator, discovery });

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    expect(probeCount).toBe(0);
  });
});

describe('validateActionScopeIntact — empty diagnostics.loginUrl branch', () => {
  it('treats an empty diagnostics.loginUrl as "still on login URL" (test-default branch)', async () => {
    /**
     * Mirrors the early-return inside `hasStayedOnLoginUrl` when
     * `loginUrl.length === 0` — the default test-context value.
     *
     * @returns 1 (form still present → must fail-loud).
     */
    const countBySelector = (): Promise<number> => Promise.resolve(1);
    const mediator = makeMockMediator({
      countBySelector,
      /**
       * Any URL is acceptable here since the empty-loginUrl branch
       * triggers before any URL comparison.
       *
       * @returns Some URL.
       */
      getCurrentUrl: (): string => 'about:blank',
    });
    const discovery = makeDiscoveryWithPassword('#password');
    const ctx = buildCtx({ mediator, discovery, loginUrl: '' });

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!wasOk) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });
});

/**
 * Build a stub auth-failure watcher pre-loaded with one captured
 * failure — used to exercise `detectAuthApiFailure`'s
 * captured-truthy branch and the `??` fallback inside
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
   * Async probe — resolves with the captured failure.
   *
   * @returns The captured failure.
   */
  const waitForFailure = (): Promise<IAuthFailure | false> => Promise.resolve(captured);
  /**
   * Synchronous probe — returns the captured failure verbatim.
   *
   * @returns The captured failure.
   */
  const hasFailed = (): IAuthFailure | false => captured;
  /**
   * No-op reset — these tests never replay across attempts.
   *
   * @returns True (contract-required boolean).
   */
  const reset = (): boolean => true;
  /**
   * No-op dispose — these tests never tear down listeners.
   *
   * @returns True (contract-required boolean).
   */
  const dispose = (): boolean => true;
  return { waitForFailure, hasFailed, reset, dispose };
}

/**
 * Wrap a base mediator with a custom auth-failure watcher attached
 * to its `network` surface. The base mediator's URL/probe stubs are
 * preserved unchanged.
 *
 * @param base - Mediator returned by `makeMockMediator`.
 * @param watcher - Auth-failure watcher to attach.
 * @returns A mediator with the override applied.
 */
function withAuthWatcher(
  base: ReturnType<typeof makeMockMediator>,
  watcher: IAuthFailureWatcher,
): ReturnType<typeof makeMockMediator> {
  const networkOverride: INetworkDiscovery = {
    ...base.network,
    authFailureWatcher: watcher,
  };
  return makeMockMediator({
    ...base,
    network: networkOverride,
  });
}

describe('executeValidateLogin — early/late detectAuthApiFailure short-circuit', () => {
  it('fails LOUD with InvalidPassword when the auth-failure watcher reports an http-4xx hit', async () => {
    const watcher = makeFiredAuthWatcher('http-4xx');
    const baseMediator = makeMockMediator({
      /**
       * Login URL unchanged — would normally let
       * `validateActionScopeIntact` run, but the early auth-API
       * detector wins the race first.
       *
       * @returns The login URL.
       */
      getCurrentUrl: (): string => LOGIN_URL,
    });
    const mediator = withAuthWatcher(baseMediator, watcher);
    const discovery = makeDiscoveryWithPassword('#password');
    const ctx = buildCtx({ mediator, discovery });

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!wasOk) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('fails LOUD with InvalidPassword when the watcher reports a body-error layer hit', async () => {
    const watcher = makeFiredAuthWatcher('body-error');
    const baseMediator = makeMockMediator({
      /**
       * Login URL unchanged — body-error detector wins.
       *
       * @returns The login URL.
       */
      getCurrentUrl: (): string => LOGIN_URL,
    });
    const mediator = withAuthWatcher(baseMediator, watcher);
    const discovery = makeDiscoveryWithPassword('#password');
    const ctx = buildCtx({ mediator, discovery });

    const result = await executeValidateLogin(
      TEST_CONFIG as unknown as ILoginConfig,
      mediator,
      ctx,
    );

    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!wasOk) expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });
});
