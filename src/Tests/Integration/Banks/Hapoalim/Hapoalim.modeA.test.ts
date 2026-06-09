/**
 * Hapoalim bank — Mode A integration test (Phase 11).
 *
 * <p>Loads each captured phase HTML snapshot (01-home through 09-dashboard)
 * into a real Playwright page via {@link loadStep} and asserts STRUCTURAL
 * invariants. This is the "static drive" leg of Phase 11 coverage: it
 * proves every committed Hapoalim fixture matches the DOM contract the
 * production scraper relies on, deterministically, offline, no creds.
 *
 * <p>Companion to {@link ./Hapoalim.modeB.test.ts} which exercises the
 * scrape + terminate phases through the {@link installSimulator} state
 * machine.
 *
 * <p>Per-phase invariants are declared in
 * {@link ./HapoalimPhaseConfig.PHASE_EXPECTATIONS}.
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
import { type IPhaseExpectation, PHASE_EXPECTATIONS } from './HapoalimPhaseConfig.js';

const BANK_ID = 'hapoalim';
const BROWSER_BOOT_TIMEOUT_MS = 120000;
const STEP_TIMEOUT_MS = 60000;

/**
 * Whether the fixture directory exists; skip the entire test otherwise.
 * @returns true when fixtures present.
 */
function isFixtureRootPresent(): boolean {
  const root = resolveFixtureRoot(BANK_ID);
  return fsSync.existsSync(root);
}

/**
 * Outcome of a single marker presence check.
 */
interface IMarkerCheck {
  readonly found: true;
  readonly marker: string;
}

/**
 * Assert a single marker exists in the page HTML.
 * @param html - Full page HTML content.
 * @param marker - Required substring.
 * @param stepName - Step name for the error message.
 * @returns Confirmation that the marker was found (throws otherwise).
 */
function assertOneMarker(html: string, marker: string, stepName: string): IMarkerCheck {
  if (!html.includes(marker)) {
    throw new ScraperError(`Hapoalim.modeA: step ${stepName} missing marker "${marker}"`);
  }
  return { found: true, marker };
}

/**
 * Assert the page body contains every required marker substring.
 * Throws {@link ScraperError} (NOT Jest's expect) so the failure
 * carries the bank+step context for debugging real-bank regressions.
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
    assertOneMarker(html, marker, stepName);
  }
}

describe('Hapoalim Mode A — static phase drive (Phase 11)', () => {
  const shouldSkip = !isFixtureRootPresent();
  const itOrSkip = shouldSkip ? it.skip : it;

  beforeAll(async () => {
    if (!shouldSkip) {
      await getIntegrationBrowser();
    }
  }, BROWSER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (!shouldSkip) {
      await closeIntegrationBrowser();
    }
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
