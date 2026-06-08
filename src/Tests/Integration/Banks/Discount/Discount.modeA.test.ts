/**
 * Discount bank — Mode A integration test (Phase 11).
 *
 * <p>Loads each captured phase HTML snapshot (01-home through 11-balance)
 * into a real Playwright page via {@link loadStep} and asserts STRUCTURAL
 * invariants. This is the "static drive" leg of Phase 11 coverage: it
 * proves every committed Discount fixture matches the DOM contract the
 * production scraper relies on, deterministically, offline, no creds.
 *
 * <p>Companion to {@link ./Discount.modeB.test.ts} which exercises the
 * same phases through the {@link installSimulator} state machine.
 *
 * <p>Per-phase invariants:
 * <ul>
 *   <li>HOME: contains the bank landing-page marker (discountbank.co.il).</li>
 *   <li>PRE-LOGIN: contains the login form id-input + bank-account input.</li>
 *   <li>POST-LOGIN phases: contain dashboard marker text (telebank).</li>
 * </ul>
 */

import * as fsSync from 'node:fs';

import type { Page } from 'playwright-core';

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import {
  loadBankFixturePaths,
  loadStep,
  newFixturePage,
  resolveFixtureRoot,
} from '../../Helpers/FixturePage.js';
import {
  closeIntegrationBrowser,
  getIntegrationBrowser,
} from '../../Helpers/IntegrationBrowserFixture.js';
import { closeQuietly } from '../../Helpers/IntegrationDriveAssertions.js';

const BANK_ID = 'discount';
const BROWSER_BOOT_TIMEOUT_MS = 120000;
const STEP_TIMEOUT_MS = 60000;

/** Per-phase contract — what markers MUST appear in the captured HTML. */
interface IPhaseExpectation {
  readonly stepName: string;
  readonly mustContain: readonly string[];
}

const PHASE_EXPECTATIONS: readonly IPhaseExpectation[] = [
  { stepName: '01-home', mustContain: ['discountbank.co.il'] },
  { stepName: '02-pre-login', mustContain: ['tzId', 'aidnum'] },
  { stepName: '04-login-action', mustContain: ['telebank'] },
  { stepName: '07-auth-discovery', mustContain: ['telebank'] },
  { stepName: '08-account-resolve', mustContain: ['telebank'] },
  { stepName: '09-dashboard', mustContain: ['telebank'] },
  { stepName: '10-scrape-transactions', mustContain: ['telebank'] },
  { stepName: '11-balance', mustContain: ['telebank'] },
];

/**
 * Whether the fixture directory exists; skip the entire test otherwise.
 * @returns true when fixtures present.
 */
function isFixtureRootPresent(): boolean {
  const root = resolveFixtureRoot(BANK_ID);
  return fsSync.existsSync(root);
}

/**
 * Assert the page body contains every required marker substring.
 * @param page - Playwright page with the step HTML loaded.
 * @param mustContain - Markers that MUST appear in the body text or HTML.
 * @param stepName - Step name for the error message.
 */
async function assertBodyContains(
  page: Page,
  mustContain: readonly string[],
  stepName: string,
): Promise<void> {
  const html = await page.content();
  for (const marker of mustContain) {
    if (!html.includes(marker)) {
      throw new ScraperError(`Discount.modeA: step ${stepName} missing marker "${marker}"`);
    }
    expect(html).toContain(marker);
  }
}

describe('Discount Mode A — static phase drive (Phase 11)', () => {
  const shouldSkip = !isFixtureRootPresent();
  const itOrSkip = shouldSkip ? it.skip : it;

  beforeAll(async () => {
    if (!shouldSkip) {
      await getIntegrationBrowser();
    }
    return 0;
  }, BROWSER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (!shouldSkip) {
      await closeIntegrationBrowser();
    }
    return 0;
  });

  describe.each(PHASE_EXPECTATIONS)('phase $stepName', (phase: IPhaseExpectation) => {
    itOrSkip(
      'captured HTML matches structural invariants',
      async () => {
        const browser = await getIntegrationBrowser();
        const page = await newFixturePage(browser);
        try {
          const paths = await loadBankFixturePaths(BANK_ID);
          await loadStep(page, paths, phase.stepName);
          await assertBodyContains(page, phase.mustContain, phase.stepName);
        } finally {
          await closeQuietly(page);
        }
      },
      STEP_TIMEOUT_MS,
    );
  });
});
