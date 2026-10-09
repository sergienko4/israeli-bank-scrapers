/**
 * Mizrahi — Mode A static drive.
 *
 * <p>Two legs, offline and credential-free:
 * <ul>
 *   <li>STRUCTURAL: every captured step carries the Mizrahi bank-identity
 *       marker ({@link PHASE_EXPECTATIONS}).</li>
 *   <li>DRIVE: production LOGIN PRE discovery ({@link executeDiscoverFields})
 *       with the production {@link MIZRAHI_LOGIN} config resolves the
 *       username by its visible label `משתמש` (WK labelText, not the
 *       positional fallback), the password, and the submit button on the
 *       login iframe document.</li>
 * </ul>
 *
 * <p>Companion to `Unit/Integration/Banks/Mizrahi/Mizrahi.modeB.test.ts`,
 * which walks the simulator manifest INIT → … → TERMINATE.
 */

import type { Page } from 'playwright-core';

import { MIZRAHI_LOGIN } from '../../../../Scrapers/Pipeline/Banks/Mizrahi/MizrahiPipeline.js';
import { createElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { executeDiscoverFields } from '../../../../Scrapers/Pipeline/Mediator/Login/LoginFieldDiscovery.js';
import type { ILoginFieldDiscovery } from '../../../../Scrapers/Pipeline/Types/Domain/LoginTypes.js';
import {
  loadBankFixturePaths,
  loadStep,
  newFixturePage,
  readStepHtml,
} from '../../Helpers/FixturePage.js';
import {
  closeIntegrationBrowser,
  getIntegrationBrowser,
} from '../../Helpers/IntegrationBrowserFixture.js';
import { closeQuietly, makeSilentLogger } from '../../Helpers/IntegrationDriveAssertions.js';
import {
  type IPhaseExpectation,
  MIZRAHI_LOGIN_STEP,
  PHASE_EXPECTATIONS,
} from './MizrahiPhaseConfig.js';

const BANK_ID = 'mizrahi';
const BROWSER_BOOT_TIMEOUT_MS = 120000;
const DRIVE_TIMEOUT_MS = 120000;

/**
 * Markers from a step's contract that its captured HTML lacks.
 * @param phase - Step contract.
 * @returns Missing markers (empty when the step matches).
 */
async function missingMarkers(phase: IPhaseExpectation): Promise<readonly string[]> {
  const paths = await loadBankFixturePaths(BANK_ID);
  const html = await readStepHtml(paths, phase.stepName);
  return phase.mustContain.filter((marker): boolean => !html.includes(marker));
}

/**
 * Run production field discovery with the production Mizrahi login config.
 * @param page - Page holding the login iframe document.
 * @returns Discovery result.
 */
function discoverOn(page: Page): Promise<ILoginFieldDiscovery> {
  const mediator = createElementMediator(page);
  const logger = makeSilentLogger();
  const config = MIZRAHI_LOGIN;
  return executeDiscoverFields({ mediator, config, activeFrame: page, page, logger });
}

/**
 * Open a fresh page on the shared integration browser.
 * @returns Blank fixture page.
 */
async function openFixturePage(): Promise<Page> {
  const browser = await getIntegrationBrowser();
  return newFixturePage(browser);
}

/**
 * Load the captured login iframe document into a page.
 * @param page - Target page.
 * @returns Resolves once the step is loaded.
 */
async function loadLoginStep(page: Page): Promise<void> {
  const paths = await loadBankFixturePaths(BANK_ID);
  await loadStep(page, paths, MIZRAHI_LOGIN_STEP);
}

/**
 * Load the login iframe document and run production field discovery.
 * @returns Discovery result.
 */
async function discoverLoginStep(): Promise<ILoginFieldDiscovery> {
  const page = await openFixturePage();
  try {
    await loadLoginStep(page);
    return await discoverOn(page);
  } finally {
    await closeQuietly(page);
  }
}

describe('Mizrahi Mode A — static phase drive', () => {
  beforeAll(async () => {
    await getIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await closeIntegrationBrowser();
  });

  it.each(PHASE_EXPECTATIONS)('step $stepName carries the bank marker', async phase => {
    const missing = await missingMarkers(phase);
    expect(missing).toEqual([]);
  });

  it(
    'LOGIN discovery resolves username by label, password and submit',
    async () => {
      const result = await discoverLoginStep();
      const username = result.targets.get('username');
      expect(username?.kind).toBe('labelText');
      const hasPassword = result.targets.has('password');
      expect(hasPassword).toBe(true);
      expect(result.submitTarget.has).toBe(true);
    },
    DRIVE_TIMEOUT_MS,
  );
});
