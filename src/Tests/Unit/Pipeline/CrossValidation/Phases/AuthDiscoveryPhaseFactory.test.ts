/**
 * Phase H.T3c.7 — cross-bank AUTH-DISCOVERY per-phase factory.
 *
 * <p>Drives every bank's PII-redacted captured cookie snapshot
 * through production {@link executeAuthDiscoveryPost} and asserts
 * the slim {@link IAuthDiscovery} contract commits when the
 * captured session carries >= 1 cookie. Each row consumes a
 * DEDICATED `<bank>/auth-discovery/<scenario>.json` fixture
 * (locked plan H.T3c.7 requirement: "+ 7 AUTH-DISC fixtures").
 *
 * <p>Scope (locked 2026-05-16): AUTH-DISCOVERY POST cookie-driven
 * `AUTH_DISCOVERY_SESSION_INVALID` contract only.
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback delegates to `prepareAuthRow`
 * + `assertAuthDiscoveryOutcome` helpers.
 *
 * <p>Scenarios source from shared {@link BANK_SCENARIOS} per
 * CodeRabbit finding #21 — single source of truth for the
 * cross-bank scenario list.
 */

import { executeAuthDiscoveryPost } from '../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryActions.js';
import { BANK_SCENARIOS, type IBankScenario } from './Fixtures/_BankScenarios.js';
import {
  buildLoginPhaseContext,
  loadAuthDiscoveryFixtureCookies,
} from './Fixtures/_makeLoginPhaseContext.js';
import { type IPhaseHFixture, loadPhaseFixture } from './Fixtures/_makePhaseFixture.js';

/** Bundle returned by {@link prepareAuthRow} for one scenario. */
interface IAuthRowSetup {
  readonly fixture: IPhaseHFixture;
  readonly context: ReturnType<typeof buildLoginPhaseContext>;
}

/**
 * Load the bank's AUTH-DISCOVERY fixture + cookie sidecar, build
 * the test context.
 *
 * @param row - Bank scenario from shared {@link BANK_SCENARIOS}.
 * @returns Fixture + context bundle.
 */
function prepareAuthRow(row: IBankScenario): IAuthRowSetup {
  const fixture = loadPhaseFixture(row.bank, 'auth-discovery/last-good');
  const cookies = loadAuthDiscoveryFixtureCookies(row.bank, 'last-good');
  const context = buildLoginPhaseContext(fixture, cookies);
  return { fixture, context };
}

/**
 * Drive AUTH-DISCOVERY POST and assert the success outcome plus
 * `ctx.authDiscovery` commit when expected.
 *
 * @param setup - Fixture + context bundle from {@link prepareAuthRow}.
 * @returns Resolved when assertions complete.
 */
async function assertAuthDiscoveryOutcome(setup: IAuthRowSetup): Promise<void> {
  const result = await executeAuthDiscoveryPost(setup.context);
  const shouldSucceed = setup.fixture.meta.expected.authDiscoveryPostOutcome === 'success';
  expect(result.success).toBe(shouldSucceed);
  if (result.success) {
    expect(result.value.authDiscovery.has).toBe(true);
  }
}

describe('AUTH-DISCOVERY-PHASE-FACTORY — Phase H per-bank POST contract', () => {
  it.each(BANK_SCENARIOS)(
    'authDiscoveryPost_$bank_ShouldCommitWhenCookiesPresent',
    async (row): Promise<void> => {
      const setup = prepareAuthRow(row);
      await assertAuthDiscoveryOutcome(setup);
    },
  );
});
