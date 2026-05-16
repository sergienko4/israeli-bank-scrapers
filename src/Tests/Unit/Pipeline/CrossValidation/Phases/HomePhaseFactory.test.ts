/**
 * Phase H.T3c.2 — cross-bank HOME per-phase factory.
 *
 * <p>Drives every bank's PII-redacted captured HOME shape through
 * production {@link executeValidateLoginArea} and asserts the POST
 * Procedure outcome matches the fixture's
 * `expected.homePostOutcome`. Each row consumes a dedicated
 * `<bank>/home/<scenarioId>.json` fixture (locked plan H.T3c.2: "+ 7
 * HOME fixtures").
 *
 * <p>HOME.POST cross-bank contract (per `HomeActions.ts:54-75`):
 * succeeds when ANY of (didNavigate, hasFrames, hasLoginForm) is true.
 * The factory drives `didNavigate` (URL changed from homepage) +
 * `hasFrames` (iframe-hosted login on Hapoalim-group banks) — both
 * are captured-shape signals derived from the run's URL trace + DOM
 * snapshot metadata.
 *
 * <p>Per `coding-principle-guidlines.md` "Maximum 10 lines per
 * method" the `it.each` callback delegates to two single-purpose
 * helpers (`prepareHomeRow`, `assertHomeOutcome`).
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { executeValidateLoginArea } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import { createMockLogger } from '../../Infrastructure/MockFactories.js';
import { buildHomePhaseContext } from './Fixtures/_makeHomePhaseContext.js';
import {
  type IPhaseHFixture,
  loadPhaseFixture,
  type PhaseHBank,
} from './Fixtures/_makePhaseFixture.js';

/** Per-scenario row driven by the parameterised `it.each` below. */
interface IHomeScenarioRow {
  readonly bank: PhaseHBank;
  readonly scenarioId: string;
  readonly homepageUrl: string;
  readonly postNavUrl: string;
  readonly frameCount: number;
}

/**
 * Scenarios exercised by the HOME factory. Per-bank URLs use the
 * `.example` reserved TLD; the URL-comparison contract is shape-only
 * (different URL → didNavigate=true). Hapoalim-group banks declare
 * `frameCount=2` to exercise the iframe-hosted-login branch.
 */
const SCENARIOS: readonly IHomeScenarioRow[] = [
  {
    bank: 'hapoalim',
    scenarioId: 'last-good',
    homepageUrl: 'https://bankhapoalim.example/',
    postNavUrl: 'https://login.bankhapoalim.example/ng-portals/auth/he/',
    frameCount: 2,
  },
  {
    bank: 'beinleumi',
    scenarioId: 'last-good',
    homepageUrl: 'https://www.beinleumi.example/',
    postNavUrl: 'https://login.beinleumi.example/login',
    frameCount: 0,
  },
  {
    bank: 'discount',
    scenarioId: 'last-good',
    homepageUrl: 'https://www.discount.example/',
    postNavUrl: 'https://start.telebank.example/auth',
    frameCount: 0,
  },
  {
    bank: 'amex',
    scenarioId: 'last-good',
    homepageUrl: 'https://www.amex.example/',
    postNavUrl: 'https://digital.amex.example/login',
    frameCount: 0,
  },
  {
    bank: 'isracard',
    scenarioId: 'last-good',
    homepageUrl: 'https://www.isracard.example/',
    postNavUrl: 'https://digital.isracard.example/personalarea/login',
    frameCount: 0,
  },
  {
    bank: 'max',
    scenarioId: 'last-good',
    homepageUrl: 'https://www.max.example/',
    postNavUrl: 'https://www.max.example/login-page',
    frameCount: 0,
  },
  {
    bank: 'visacal',
    scenarioId: 'last-good',
    homepageUrl: 'https://www.cal-online.example/',
    postNavUrl: 'https://login.cal-online.example/Login',
    frameCount: 0,
  },
];

/** Bundle returned by {@link prepareHomeRow} for one scenario. */
interface IHomeRowSetup {
  readonly fixture: IPhaseHFixture;
  readonly subject: ReturnType<typeof buildHomePhaseContext>;
}

/**
 * Load the bank's HOME fixture + build the test subject.
 *
 * @param row - Scenario row identifying bank + URLs + frame count.
 * @returns Fixture + subject bundle.
 */
function prepareHomeRow(row: IHomeScenarioRow): IHomeRowSetup {
  const fixture = loadPhaseFixture(row.bank, `home/${row.scenarioId}`);
  const subject = buildHomePhaseContext({
    homepageUrl: row.homepageUrl,
    postNavUrl: row.postNavUrl,
    frameCount: row.frameCount,
  });
  return { fixture, subject };
}

/**
 * Drive HOME.POST through production code and assert the success
 * outcome from the fixture's `expected.homePostOutcome`. Throws a
 * typed `ScraperError` (per project convention) when the mediator
 * option is unexpectedly absent.
 *
 * @param setup - Fixture + subject bundle.
 * @returns Resolved when the assertion completes.
 */
async function assertHomeOutcome(setup: IHomeRowSetup): Promise<void> {
  if (!setup.subject.context.mediator.has) {
    throw new ScraperError('HOME_FACTORY: mediator missing');
  }
  const result = await executeValidateLoginArea({
    mediator: setup.subject.context.mediator.value,
    input: setup.subject.context,
    homepageUrl: setup.subject.homepageUrl,
    logger: createMockLogger(),
  });
  const shouldSucceed = setup.fixture.meta.expected.homePostOutcome === 'success';
  expect(result.success).toBe(shouldSucceed);
}

describe('HOME-PHASE-FACTORY — Phase H per-bank HOME.POST contract', () => {
  it.each(SCENARIOS)(
    'homePost_$bank_$scenarioId_ShouldValidateLoginArea',
    async (row): Promise<void> => {
      const setup = prepareHomeRow(row);
      await assertHomeOutcome(setup);
    },
  );
});
