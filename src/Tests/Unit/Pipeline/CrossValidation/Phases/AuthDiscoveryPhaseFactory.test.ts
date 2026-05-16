/**
 * Phase H.T3c.7 — cross-bank AUTH-DISCOVERY per-phase factory.
 *
 * <p>Drives every bank's PII-redacted captured cookie snapshot through
 * production {@link executeAuthDiscoveryPost} and asserts the slim
 * {@link IAuthDiscovery} contract commits when the captured session
 * carries >= 1 cookie. Each row consumes a DEDICATED
 * `<bank>/auth-discovery/<scenario>.json` fixture (locked plan
 * H.T3c.7 requirement: "+ 7 AUTH-DISC fixtures"). The cookie set
 * is sourced from the same captured run that produced the bank's
 * LOGIN.FINAL state — at AUTH-DISCOVERY POST entry the jar is
 * structurally identical (no inter-phase mutation) — but the
 * fixture metadata, scenario id, and per-bank rationale are
 * AUTH-DISCOVERY-specific.
 *
 * <p>Scope (locked 2026-05-16): AUTH-DISCOVERY POST cookie-driven
 * `AUTH_DISCOVERY_SESSION_INVALID` contract only. Per
 * `AuthDiscoveryActions.ts` line 161, POST fails loud when
 * `cookieAudit.count === 0` and succeeds when >= 1 — matching the
 * legacy LOGIN.FINAL behaviour M1 preserved. Dashboard-reveal probe
 * + auth-channel collection emit `false`/empty under the default
 * mock-mediator surface; those signals ride the slim
 * {@link IAuthDiscovery} record as data, not as POST-failure modes.
 *
 * <p>Complements {@link AuthDiscoveryFactoryTest} (M1 isolation-tier
 * factory with inline per-bank synthetic fixtures). M1 covers the
 * channel/header collection shape; H.T3c.7 covers the session-cookie
 * sentinel against captured per-bank shape. Both layers retained per
 * `testing-organization-guidlines.md` "integration tests over unit
 * tests, unit tests for edge cases only".
 */

import { executeAuthDiscoveryPost } from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryActions.js';
import {
  buildLoginPhaseContext,
  loadAuthDiscoveryFixtureCookies,
} from './Fixtures/_makeLoginPhaseContext.js';
import { loadPhaseFixture, type PhaseHBank } from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface IAuthDiscoveryScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
}

/**
 * Scenarios exercised by the AUTH-DISCOVERY factory. Each row points
 * to its DEDICATED `<bank>/auth-discovery/<scenarioId>.json` fixture
 * (locked plan H.T3c.7: 7 AUTH-DISC fixtures).
 */
const SCENARIOS: readonly IAuthDiscoveryScenarioRow[] = [
  { bank: 'hapoalim', scenarioId: 'last-good' },
  { bank: 'beinleumi', scenarioId: 'last-good' },
  { bank: 'discount', scenarioId: 'last-good' },
  { bank: 'amex', scenarioId: 'last-good' },
  { bank: 'isracard', scenarioId: 'last-good' },
  { bank: 'max', scenarioId: 'last-good' },
  { bank: 'visacal', scenarioId: 'last-good' },
];

describe('AUTH-DISCOVERY-PHASE-FACTORY — Phase H per-bank POST contract', () => {
  it.each(SCENARIOS)(
    'authDiscoveryPost_$bank_$scenarioId_ShouldCommitWhenCookiesPresent',
    async (row): Promise<void> => {
      const fixture = loadPhaseFixture(row.bank, `auth-discovery/${row.scenarioId}`);
      const cookies = loadAuthDiscoveryFixtureCookies(row.bank, row.scenarioId);
      const context = buildLoginPhaseContext(fixture, cookies);

      const result = await executeAuthDiscoveryPost(context);

      const shouldSucceed = fixture.meta.expected.authDiscoveryPostOutcome === 'success';
      expect(result.success).toBe(shouldSucceed);
      if (result.success) {
        expect(result.value.authDiscovery.has).toBe(true);
      }
    },
  );
});
