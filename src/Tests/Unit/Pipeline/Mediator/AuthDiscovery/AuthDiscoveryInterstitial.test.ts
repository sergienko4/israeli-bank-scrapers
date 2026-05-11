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
};

const SNAP_NOT_READY: IAuthDiscovery = { ...SNAP_READY, dashboardReady: false };

const ISRACARD_STATUSPAGE_URL = 'https://web.isracard.co.il/StatusPage';
const FIVE_REAL_SESSION_COOKIES = [
  'svSession',
  'XSRF-TOKEN',
  'bSession',
  'JSESSIONID',
  '__cfwaitingroom',
];
const TWO_TRACKING_COOKIES = ['is_eu', 'tt_sessionId'];

const SNAP_READY_BEARER_TOKEN: IAuthDiscovery = {
  ...SNAP_READY,
  authToken: 'bearer:opaque-jwt-from-network-discovery',
};
const SNAP_READY_FIVE_COOKIES: IAuthDiscovery = {
  ...SNAP_READY,
  sessionCookieNames: FIVE_REAL_SESSION_COOKIES,
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
 * is present. Motivated by the PR #221 CI Isracard regression: the SPA
 * stays on `/StatusPage` from login screen through dashboard reveal
 * (same-URL routing), so `currentUrl === preAuthUrl` even though REVEAL
 * + a discovered Bearer token + 60 post-auth session cookies all agree
 * the dashboard is ready. An interstitial would not produce both a real
 * authToken AND a multi-cookie session — so those signals are sufficient
 * corroboration to override the URL-change requirement.
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

  it('returns open when URL is stuck but at least five session cookies were captured', () => {
    const reason = dashboardGateReason(
      SNAP_READY_FIVE_COOKIES,
      ISRACARD_STATUSPAGE_URL,
      ISRACARD_STATUSPAGE_URL,
    );
    expect(reason).toBe('open');
  });

  it('returns url-stuck when URL is stuck AND signals are weak (no authToken, only tracking cookies)', () => {
    const reason = dashboardGateReason(
      SNAP_READY_TRACKING_ONLY,
      ISRACARD_STATUSPAGE_URL,
      ISRACARD_STATUSPAGE_URL,
    );
    expect(reason).toBe('url-stuck');
  });
});
