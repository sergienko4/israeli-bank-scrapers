/**
 * AMEX bank — Mode A integration test (Phase 11).
 *
 * <p>Loads each captured phase HTML snapshot into a real Playwright
 * page via {@link loadStep} and asserts STRUCTURAL invariants. This is
 * the "static drive" leg of Phase 11 coverage: it proves every
 * committed AMEX fixture matches the DOM contract the production
 * scraper relies on, deterministically, offline, no creds.
 *
 * <p>Companion to {@link ../../../Unit/Integration/Banks/Amex/Amex.modeB.test.ts}
 * which exercises the full 9-phase chain (AMEX skips OTP — password +
 * id + card6Digits) through the {@link installSimulator} state machine
 * using the committed `manifest.json` + `responses/*.json`.
 *
 * <p>Per-phase invariants are declared in
 * {@link ./AmexPhaseConfig.PHASE_EXPECTATIONS}.
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
import { type IPhaseExpectation, PHASE_EXPECTATIONS } from './AmexPhaseConfig.js';

const BANK_ID = 'amex';
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
 * Outcome of a single marker presence check. Per
 * `no-restricted-syntax` ARCHITECTURE rule, helpers return a meaningful
 * value rather than `void`; this carries the matched marker for upstream
 * tracing in case test failures need to be correlated with phase
 * configurations.
 */
interface IMarkerCheck {
  readonly found: true;
  readonly marker: string;
}

/**
 * Assert a single marker exists in the page HTML. Throws on miss with
 * the bank+step context attached so real-bank regressions surface the
 * failing fixture by name.
 * @param html - Full page HTML content.
 * @param marker - Required substring.
 * @param stepName - Step name for the error message.
 * @returns Marker confirmation (caller may ignore; throw is contract).
 */
function assertOneMarker(html: string, marker: string, stepName: string): IMarkerCheck {
  if (!html.includes(marker)) {
    throw new ScraperError(`Amex.modeA: step ${stepName} missing marker "${marker}"`);
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

describe('Amex Mode A — static phase drive (Phase 11)', () => {
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
