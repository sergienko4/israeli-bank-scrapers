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

import { passesDashboardGate } from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryInterstitial.js';
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
