/**
 * Unit tests for AuthDiscoveryActions — branches the factory test
 * does not exercise individually:
 *   - PRE/POST/FINAL no-mediator pass-through paths
 *   - ACTION sealed pass-through (BasePhase template never invokes
 *     this directly in the factory test)
 *   - FINAL pass-through when authDiscovery is none
 */

import {
  executeAuthDiscoveryAction,
  executeAuthDiscoveryFinal,
  executeAuthDiscoveryPost,
  executeAuthDiscoveryPre,
} from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryActions.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IAuthDiscovery,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockLoginState } from '../../../Scrapers/Pipeline/MockPipelineFactories.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

describe('AuthDiscoveryActions — focused branch coverage', () => {
  it('PRE returns pass-through success when no mediator is attached', async () => {
    const ctx = makeMockContext();
    const result = await executeAuthDiscoveryPre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('PRE awaits a settle wait via mediator.waitForNetworkIdle BEFORE inventorying captures (post-login redirect grace)', async () => {
    // PR #221 review follow-up: AUTH-DISCOVERY.PRE must give the SPA
    // up to AUTH_DISCOVERY_PRE_SETTLE_MS to flush the post-login
    // redirect chatter so the inventory it reads
    // (`network.getAllEndpoints()`) reflects the final post-login
    // state, not a mid-redirect snapshot. Event-driven (uses
    // `waitForNetworkIdle`) so fast banks pay 0ms; slow banks pay
    // up to the ceiling.
    let didCallSettleWait = false;
    let didCaptureBeforeWait = false;
    const fakeMediator = {
      /**
       * Records that the settle wait was invoked AND that the
       * capture inventory was read AFTER (not before).
       *
       * @returns Resolved succeed (no settle pending).
       */
      waitForNetworkIdle: () => {
        didCallSettleWait = true;
        return Promise.resolve({ success: true as const, value: undefined });
      },
      network: {
        /**
         * Returns empty captures pool. If `didCallSettleWait` is
         * still false at this point, the inventory was read BEFORE
         * the settle wait — assertion fails.
         *
         * @returns Empty captures.
         */
        getAllEndpoints: (): readonly unknown[] => {
          didCaptureBeforeWait = !didCallSettleWait;
          return [];
        },
      },
    } as unknown as IElementMediator;
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true as const, value: fakeMediator },
    };
    const result = await executeAuthDiscoveryPre(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    expect(didCallSettleWait).toBe(true);
    expect(didCaptureBeforeWait).toBe(false);
  });

  it('ACTION returns sealed pass-through success on every input shape', async () => {
    const baseCtx = makeMockContext();
    const actionCtx = baseCtx as unknown as IActionContext;
    const result = await executeAuthDiscoveryAction(actionCtx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('POST returns pass-through success when no mediator is attached', async () => {
    const ctx = makeMockContext();
    const result = await executeAuthDiscoveryPost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('FINAL passes through when authDiscovery is none (test path)', async () => {
    const ctx = makeMockContext();
    const result = await executeAuthDiscoveryFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('FINAL emits the committed telemetry event when authDiscovery is some', async () => {
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: 'fake-bearer',
      origin: 'https://example.bank',
      siteId: '10',
      headers: { 'X-Site-Id': '10' },
      dashboardReady: true,
      sessionCookieNames: ['JSESSIONID', 'PSEK'],
      hasAuthApiResponse: false,
    };
    const ctx = { ...baseCtx, authDiscovery: some(snap) };
    const result = await executeAuthDiscoveryFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  // ── M4.F1 — dashboard-gate (REVEAL + URL changed from login) ──────
  // Forcing function: PR #221 / Isracard CI run `25633964342`,
  // runId `10-05-2026_16381614`. AUTH-DISCOVERY.POST already had
  // `dashboardReady=false` but FINAL did nothing with it; DASHBOARD.PRE
  // then failed with the cryptic "no navigation target found" message
  // after 122 s. The two-signal gate moves the failure to
  // AUTH-DISCOVERY.FINAL with a clear domain fail-code.

  it('FINAL fails loud AUTH_DISCOVERY_DASHBOARD_NOT_READY when REVEAL did not match (snap.dashboardReady=false)', async () => {
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: 'fake-bearer',
      origin: 'https://web.isracard.co.il',
      siteId: false,
      headers: {},
      dashboardReady: false,
      sessionCookieNames: ['JSESSIONID'],
      hasAuthApiResponse: false,
    };
    const ctx = { ...baseCtx, authDiscovery: some(snap) };
    const result = await executeAuthDiscoveryFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!isOk(result)) {
      expect(result.errorMessage).toContain('AUTH_DISCOVERY_DASHBOARD_NOT_READY');
    }
  });

  it('FINAL fails loud AUTH_DISCOVERY_DASHBOARD_NOT_READY when URL never changed AND auth signals are weak', async () => {
    // M4.F1.fix: url-stuck is only fatal when corroboration is also
    // weak (no authToken, no hasAuthApiResponse). Strong signals override.
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: false,
      origin: false,
      siteId: false,
      headers: {},
      dashboardReady: true,
      sessionCookieNames: [],
      hasAuthApiResponse: false,
    };
    const fakeMediator = {
      /**
       * Stubs the URL probe — returns the same string the pre-auth
       * baton holds so the URL-change gate fails (mirror of the
       * Isracard CI flow where the SPA stuck on the redirect page).
       *
       * @returns Pre-auth URL unchanged.
       */
      getCurrentUrl: (): string => 'https://web.isracard.co.il/Login',
      /**
       * No-op settle wait — FINAL awaits this before reading the URL
       * so the gate compares against the FINAL post-auth URL.
       *
       * @returns Resolved succeed.
       */
      waitForNetworkIdle: () => Promise.resolve({ success: true as const, value: undefined }),
    } as unknown as IElementMediator;
    const ctx = {
      ...baseCtx,
      authDiscovery: some(snap),
      mediator: { has: true as const, value: fakeMediator },
      login: some({ ...makeMockLoginState(), urlBeforeSubmit: 'https://web.isracard.co.il/Login' }),
    };
    const result = await executeAuthDiscoveryFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!isOk(result)) {
      expect(result.errorMessage).toContain('AUTH_DISCOVERY_DASHBOARD_NOT_READY');
    }
  });

  it('FINAL settle wait swallows waitForNetworkIdle rejections without cascading (covers the .catch path)', async () => {
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: 'fake-bearer',
      origin: 'https://web.isracard.co.il',
      siteId: false,
      headers: {},
      dashboardReady: true,
      sessionCookieNames: ['JSESSIONID'],
      hasAuthApiResponse: false,
    };
    const fakeMediator = {
      /**
       * URL probe — returns a dashboard URL distinct from LOGIN.PRE
       * emit so the URL-change gate would pass.
       *
       * @returns Distinct dashboard URL.
       */
      getCurrentUrl: (): string => 'https://web.isracard.co.il/Site/Dashboard',
      /**
       * Stub the settle wait as REJECTING. FINAL must swallow this
       * (page may be transient mid-redirect) and proceed to read
       * the URL anyway. Test asserts the rejection does not cascade.
       *
       * @returns Rejected promise.
       */
      waitForNetworkIdle: () => Promise.reject(new Error('settle aborted')),
    } as unknown as IElementMediator;
    const ctx = {
      ...baseCtx,
      authDiscovery: some(snap),
      mediator: { has: true as const, value: fakeMediator },
      login: some({ ...makeMockLoginState(), urlBeforeSubmit: 'https://web.isracard.co.il/Login' }),
    };
    const result = await executeAuthDiscoveryFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });

  it('FINAL PART A: login URL always used as pre-auth baseline even when otpFill and otpTrigger are present', async () => {
    // PART A fix: readPreAuthUrl now reads login.urlBeforeSubmit exclusively.
    // The OTP-FILL/OTP-TRIGGER batons are re-captured after login's redirect
    // and carry the post-redirect URL, not the login-page URL. Using them
    // clobbers the login-URL baseline (Isracard: digital→web clobber).
    //
    // Setup: login URL = 'https://web.bank/login', otpFill URL = currentUrl =
    // 'https://web.bank/otp'. After fix, preAuthUrl = 'web.bank/login' which
    // differs from currentUrl 'web.bank/otp' → gate opens (url-moved).
    // On OLD code preAuthUrl was otpFill URL = 'web.bank/otp' = currentUrl
    // → url-stuck → FAIL. Test is RED on old code, GREEN on new code.
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: false,
      origin: false,
      siteId: false,
      headers: {},
      dashboardReady: true,
      sessionCookieNames: [],
      hasAuthApiResponse: false,
    };
    const fakeMediator = {
      /**
       * Returns currentUrl matching otpFill's emit URL (post-redirect).
       * @returns OTP-fill's URL.
       */
      getCurrentUrl: (): string => 'https://web.bank/otp',
      /**
       * No-op settle wait.
       * @returns Resolved succeed.
       */
      waitForNetworkIdle: () => Promise.resolve({ success: true as const, value: undefined }),
    } as unknown as IElementMediator;
    const ctx = {
      ...baseCtx,
      authDiscovery: some(snap),
      mediator: { has: true as const, value: fakeMediator },
      login: some({ ...makeMockLoginState(), urlBeforeSubmit: 'https://web.bank/login' }),
      otpTrigger: some({
        phoneHint: '',
        triggered: false,
        scopeValidated: false,
        urlBeforeSubmit: 'https://web.bank/otp-trigger',
      }),
      otpFill: some({ urlBeforeSubmit: 'https://web.bank/otp' }),
    };
    const result = await executeAuthDiscoveryFinal(ctx);
    // After PART A fix: login URL differs from currentUrl → gate opens.
    const isGateOpen = isOk(result);
    expect(isGateOpen).toBe(true);
  });

  it('FINAL precedence: ctx.otpTrigger wins over ctx.login when otpFill is none', async () => {
    // Flow 2: LOGIN → OTP-TRIGGER → AUTH-DISCOVERY (no OTP-FILL).
    // After PART A fix: login URL is used (not otpTrigger). Here
    // login URL = otpTrigger URL = currentUrl = 'web.bank/login', so
    // the gate still reaches url-stuck either way — test outcome unchanged.
    //
    // Weak corroboration keeps the url-stuck failure path reachable.
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: false,
      origin: false,
      siteId: false,
      headers: {},
      dashboardReady: true,
      sessionCookieNames: [],
      hasAuthApiResponse: false,
    };
    const fakeMediator = {
      /**
       * URL probe — matches OTP-TRIGGER's carried URL so the gate
       * fails on URL-stuck (proves otpTrigger was read).
       * @returns OTP-TRIGGER's emit URL.
       */
      getCurrentUrl: (): string => 'https://web.bank/login',
      /**
       * No-op settle wait.
       * @returns Resolved succeed.
       */
      waitForNetworkIdle: () => Promise.resolve({ success: true as const, value: undefined }),
    } as unknown as IElementMediator;
    const ctx = {
      ...baseCtx,
      authDiscovery: some(snap),
      mediator: { has: true as const, value: fakeMediator },
      login: some({ ...makeMockLoginState(), urlBeforeSubmit: 'https://web.bank/login' }),
      otpTrigger: some({
        phoneHint: '',
        triggered: true,
        scopeValidated: true,
        urlBeforeSubmit: 'https://web.bank/login',
      }),
    };
    const result = await executeAuthDiscoveryFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!isOk(result)) {
      expect(result.errorMessage).toContain('AUTH_DISCOVERY_DASHBOARD_NOT_READY');
    }
  });

  it('FINAL passes through when REVEAL matched AND URL changed from the pre-auth baton (happy-path regression guard)', async () => {
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: 'fake-bearer',
      origin: 'https://web.isracard.co.il',
      siteId: false,
      headers: {},
      dashboardReady: true,
      sessionCookieNames: ['JSESSIONID'],
      hasAuthApiResponse: false,
    };
    const fakeMediator = {
      /**
       * Stubs the URL probe — returns a dashboard URL distinct from
       * what LOGIN emitted so the URL-change gate passes.
       *
       * @returns Dashboard URL distinct from LOGIN's emit.
       */
      getCurrentUrl: (): string => 'https://web.isracard.co.il/Site/Dashboard',
      /**
       * No-op settle wait — FINAL awaits this before reading the URL.
       *
       * @returns Resolved succeed.
       */
      waitForNetworkIdle: () => Promise.resolve({ success: true as const, value: undefined }),
    } as unknown as IElementMediator;
    const ctx = {
      ...baseCtx,
      authDiscovery: some(snap),
      mediator: { has: true as const, value: fakeMediator },
      login: some({ ...makeMockLoginState(), urlBeforeSubmit: 'https://web.isracard.co.il/Login' }),
    };
    const result = await executeAuthDiscoveryFinal(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
  });
});
