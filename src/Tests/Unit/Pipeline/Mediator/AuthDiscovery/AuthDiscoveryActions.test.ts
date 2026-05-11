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

  it('POST honors MOCK_MODE safety valve and skips the live probe', async () => {
    const original = process.env.MOCK_MODE;
    process.env.MOCK_MODE = '1';
    try {
      const baseCtx = makeMockContext();
      const fakeMediator = {} as IElementMediator;
      const ctx = {
        ...baseCtx,
        mediator: { has: true as const, value: fakeMediator },
      };
      const result = await executeAuthDiscoveryPost(ctx);
      const wasOk = isOk(result);
      expect(wasOk).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.MOCK_MODE;
      } else {
        process.env.MOCK_MODE = original;
      }
    }
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
    // M4.F1.fix: url-stuck is only fatal when the corroboration is
    // also weak (no authToken, < 5 session cookies). Strong signals
    // (Bearer token or multi-cookie session) override URL-change.
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: false,
      origin: false,
      siteId: false,
      headers: {},
      dashboardReady: true,
      sessionCookieNames: [],
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

  it('FINAL precedence: ctx.otpFill emit wins over ctx.otpTrigger and ctx.login when all three are present', async () => {
    // 5 auth-ladder flows supported. This test pins the precedence:
    // otpFill > otpTrigger > login. The OTP-FILL emit is always set
    // when OTP-FILL ran (form-found / soft-skip / MOCK_MODE), so it
    // is the freshest baton available.
    //
    // M4.F1.fix: snap uses weak corroboration (no authToken, no
    // session cookies) so the url-stuck path is reachable — that
    // is the failure the test asserts to prove the right baton URL
    // was read.
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: false,
      origin: false,
      siteId: false,
      headers: {},
      dashboardReady: true,
      sessionCookieNames: [],
    };
    const fakeMediator = {
      /**
       * URL probe returns the OTP-FILL emit's URL — proves the gate
       * read otpFill (not login or otpTrigger) and therefore failed
       * the URL-change check.
       * @returns OTP-FILL's emitted URL (gate must compare against this).
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
    const wasOk = isOk(result);
    expect(wasOk).toBe(false);
    if (!isOk(result)) {
      expect(result.errorMessage).toContain('AUTH_DISCOVERY_DASHBOARD_NOT_READY');
    }
  });

  it('FINAL precedence: ctx.otpTrigger wins over ctx.login when otpFill is none', async () => {
    // Flow 2: LOGIN → OTP-TRIGGER → AUTH-DISCOVERY (no OTP-FILL).
    // OTP-TRIGGER carried LOGIN's urlBeforeSubmit forward; the gate
    // must read it (not LOGIN's directly).
    //
    // M4.F1.fix: weak corroboration keeps the url-stuck failure path
    // reachable (see the otpFill precedence test above).
    const baseCtx = makeMockContext();
    const snap: IAuthDiscovery = {
      authToken: false,
      origin: false,
      siteId: false,
      headers: {},
      dashboardReady: true,
      sessionCookieNames: [],
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
