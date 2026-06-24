/**
 * Mission M4.F1 — AUTH-DISCOVERY.FINAL dashboard gate.
 *
 * Pure-predicate tests for {@link passesDashboardGate}. The gate is
 * the GENERIC two-signal check that replaced the deleted
 * `WK_BANK_REDIRECT` / `/StatusPage` / `לאפליקציה` markers:
 *   1. POSITIVE: REVEAL matched at AUTH-DISCOVERY.POST (carried as
 *      `snap.dashboardReady`).
 *   2. NEGATIVE: page URL changed from the login URL.
 * Both must be true. Either false ⇒ AUTH-DISCOVERY.FINAL fails
 * loud with `AUTH_DISCOVERY_DASHBOARD_NOT_READY` so DASHBOARD.PRE
 * never wastes its 122 s resolver budget on an interstitial /
 * redirect page (Isracard CI run `25633964342`,
 * runId `10-05-2026_16381614`).
 */

import {
  dashboardGateReason,
  passesDashboardGate,
} from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryInterstitial.js';
import type { IAuthDiscovery } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

const SNAP_READY: IAuthDiscovery = {
  authToken: false,
  origin: false,
  siteId: false,
  headers: {},
  dashboardReady: true,
  sessionCookieNames: [],
  hasAuthApiResponse: false,
};

const SNAP_NOT_READY: IAuthDiscovery = { ...SNAP_READY, dashboardReady: false };

const ISRACARD_STATUSPAGE_URL = 'https://web.isracard.co.il/StatusPage';
const TWO_TRACKING_COOKIES = ['is_eu', 'tt_sessionId'];

const SNAP_READY_BEARER_TOKEN: IAuthDiscovery = {
  ...SNAP_READY,
  authToken: 'bearer:opaque-jwt-from-network-discovery',
};
/** Snap with a captured first-party API response — the new corroboration signal. */
const SNAP_READY_AUTH_API: IAuthDiscovery = {
  ...SNAP_READY,
  hasAuthApiResponse: true,
};
const SNAP_READY_TRACKING_ONLY: IAuthDiscovery = {
  ...SNAP_READY,
  sessionCookieNames: TWO_TRACKING_COOKIES,
};

describe('M4.F1 — passesDashboardGate (pure two-signal predicate)', () => {
  it('returns true when REVEAL matched AND URL changed from login', () => {
    const wasOk = passesDashboardGate(
      SNAP_READY,
      'https://web.isracard.co.il/Site/Dashboard',
      'https://web.isracard.co.il/Login',
    );
    expect(wasOk).toBe(true);
  });

  it('returns false when REVEAL did NOT match (dashboardReady=false)', () => {
    const wasOk = passesDashboardGate(
      SNAP_NOT_READY,
      'https://web.isracard.co.il/Site/Dashboard',
      'https://web.isracard.co.il/Login',
    );
    expect(wasOk).toBe(false);
  });

  it('returns false when URL is identical to the login URL (page never navigated)', () => {
    const wasOk = passesDashboardGate(
      SNAP_READY,
      'https://web.isracard.co.il/Login',
      'https://web.isracard.co.il/Login',
    );
    expect(wasOk).toBe(false);
  });

  it('returns false when both signals fail (regression case from the Isracard CI evidence)', () => {
    const wasOk = passesDashboardGate(
      SNAP_NOT_READY,
      'https://web.isracard.co.il/Login',
      'https://web.isracard.co.il/Login',
    );
    expect(wasOk).toBe(false);
  });

  it('disables the URL gate when preAuthUrl baton is empty (mock / test paths)', () => {
    const wasOk = passesDashboardGate(SNAP_READY, '', '');
    expect(wasOk).toBe(true);
  });

  it('still fails on REVEAL miss even with the URL gate disabled', () => {
    const wasOk = passesDashboardGate(SNAP_NOT_READY, '', '');
    expect(wasOk).toBe(false);
  });
});

/**
 * M4.F1.fix — relaxes the url-stuck branch when strong auth corroboration
 * is present. Replaces the removed cookie-COUNT floor with two real auth
 * signals: authToken (unchanged) and hasAuthApiResponse (new). An
 * unauthenticated page never fires the authed data fetch; an interstitial
 * never produces a Bearer token — so either is sufficient corroboration.
 * Cookie count was removed because analytics-only pages (e.g. Amex
 * personalarea/login) carry ~59 tracking cookies that silently defeated
 * the old floor of 5. CI forensics: same-run Amex run showed 59 garbage
 * cookies + dashboardReady=true (hidden twin) → gate opened on garbage.
 */
describe('M4.F1.fix — url-stuck relaxed when strong auth corroboration is present', () => {
  it('returns open when URL is stuck but an authToken was discovered', () => {
    const reason = dashboardGateReason(
      SNAP_READY_BEARER_TOKEN,
      ISRACARD_STATUSPAGE_URL,
      ISRACARD_STATUSPAGE_URL,
    );
    expect(reason).toBe('open');
  });

  it('returns open when URL is stuck but a captured first-party API response was found (hasAuthApiResponse)', () => {
    const reason = dashboardGateReason(
      SNAP_READY_AUTH_API,
      ISRACARD_STATUSPAGE_URL,
      ISRACARD_STATUSPAGE_URL,
    );
    expect(reason).toBe('open');
  });

  it('returns url-stuck when URL is stuck AND signals are weak (no authToken, no captured API, only tracking cookies)', () => {
    const reason = dashboardGateReason(
      SNAP_READY_TRACKING_ONLY,
      ISRACARD_STATUSPAGE_URL,
      ISRACARD_STATUSPAGE_URL,
    );
    expect(reason).toBe('url-stuck');
  });
});

// ── Pyramid tests (RED on old code, GREEN after fix) ─────────────────────────

const AMEX_LOGIN_URL = 'https://he.americanexpress.co.il/personalarea/login/';
const ISRACARD_DIGITAL_LOGIN = 'https://digital.isracard.co.il/personalarea/Login/';

/** 59 fake cookie names simulating Amex's analytics/tracking cookie pool. */
const AMEX_59_FAKE_COOKIES = Array.from(
  { length: 59 },
  (_: unknown, i: number): string => `analytics-cookie-${String(i)}`,
);

describe('Pyramid — Amex-shaped gate (key regression test)', () => {
  it('url-stuck when 59 tracking cookies, no authToken, no captured API — gate stays closed', () => {
    // On OLD code: 59 >= STRONG_AUTH_COOKIE_FLOOR(5) → open (FALSE PASS).
    // On NEW code: hasAuthApiResponse=false, authToken=false → url-stuck (CORRECT).
    const snap: IAuthDiscovery = {
      ...SNAP_READY,
      sessionCookieNames: AMEX_59_FAKE_COOKIES,
    };
    const reason = dashboardGateReason(snap, AMEX_LOGIN_URL, AMEX_LOGIN_URL);
    expect(reason).toBe('url-stuck');
  });
});

describe('Pyramid — Isracard redirect (url-moved opens gate)', () => {
  it('open when URL moved from digital/Login to web/StatusPage (url-moved signal)', () => {
    const snap: IAuthDiscovery = { ...SNAP_READY, hasAuthApiResponse: true };
    const reason = dashboardGateReason(snap, ISRACARD_STATUSPAGE_URL, ISRACARD_DIGITAL_LOGIN);
    expect(reason).toBe('open');
  });
});

describe('Pyramid — same-URL authed SPA (corroboration path)', () => {
  it('open when currentUrl==preAuthUrl but hasAuthApiResponse=true (corroboration)', () => {
    const snap: IAuthDiscovery = { ...SNAP_READY, hasAuthApiResponse: true };
    const reason = dashboardGateReason(snap, ISRACARD_STATUSPAGE_URL, ISRACARD_STATUSPAGE_URL);
    expect(reason).toBe('open');
  });

  it('url-stuck when currentUrl==preAuthUrl AND hasAuthApiResponse=false (no corroboration)', () => {
    const reason = dashboardGateReason(SNAP_READY, AMEX_LOGIN_URL, AMEX_LOGIN_URL);
    expect(reason).toBe('url-stuck');
  });
});
