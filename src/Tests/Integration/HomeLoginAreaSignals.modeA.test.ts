/**
 * T-HOMESIG — does each bank's captured homepage already show a login form?
 *
 * <p>HOME POST proves the login area two ways: the browser left the homepage,
 * or a login form is visible. This spec pins the first to `false` (by declaring
 * the fixture page's own URL as the homepage) and records the second per bank,
 * so the fallback signal is evidence rather than inference. A bank recorded
 * `false` here has no DOM fallback — its HOME phase must genuinely navigate.
 *
 * <p>HARNESS LIMIT — {@link loadStep} replays through `setContent`, which
 * rebuilds the MAIN FRAME only. Cross-origin children become empty shells, so
 * this spec deliberately does NOT assert frame counts: VisaCal shows 12 frames
 * with a visible login form live, but empty shells and no form in replay. The
 * form gate is meaningful for main-frame banks; the frame dimension is not
 * measurable here and is asserted at the unit layer instead.
 *
 * <p>No credentials, no network — HOME runs before any secret is needed.
 */

import * as fsSync from 'node:fs';

import type { Page } from 'playwright-core';

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Logging/Debug.js';
import createElementMediator from '../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { collectLoginAreaSignals } from '../../Scrapers/Pipeline/Mediator/Home/HomeActions.Validate.js';
import { some } from '../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  loadBankFixturePaths,
  loadStep,
  newFixturePage,
  resolveFixtureRoot,
} from './Helpers/FixturePage.js';
import {
  closeIntegrationBrowser,
  getIntegrationBrowser,
} from './Helpers/IntegrationBrowserFixture.js';

const BROWSER_BOOT_TIMEOUT_MS = 120_000;
const CASE_TIMEOUT_MS = 120_000;

/** Silent logger — assertions carry the diagnostics. */
const SILENT = {
  /**
   * No-op debug.
   * @returns True.
   */
  debug: (): boolean => true,
} as unknown as ScraperLogger;

/** One bank's expected homepage form signal. */
interface IHomeSignalCase {
  readonly bankId: string;
  readonly hasLoginForm: boolean;
}

/**
 * Whether each bank's captured `01-home` snapshot already exposes a login form.
 * `false` means HOME has no DOM fallback and must genuinely navigate.
 */
const CASES: readonly IHomeSignalCase[] = [
  { bankId: 'amex', hasLoginForm: false },
  { bankId: 'beinleumi', hasLoginForm: false },
  { bankId: 'discount', hasLoginForm: false },
  { bankId: 'hapoalim', hasLoginForm: false },
  { bankId: 'isracard', hasLoginForm: false },
  { bankId: 'leumi', hasLoginForm: true },
  { bankId: 'massad', hasLoginForm: false },
  { bankId: 'max', hasLoginForm: false },
  { bankId: 'mercantile', hasLoginForm: false },
  { bankId: 'otsarHahayal', hasLoginForm: false },
  { bankId: 'pagi', hasLoginForm: false },
  { bankId: 'visaCal', hasLoginForm: false },
  { bankId: 'yahav', hasLoginForm: false },
];

/**
 * Load a captured step into a fresh fixture page.
 * @param bankId - Bank fixture id.
 * @param stepName - Captured step name.
 * @returns Page holding the captured markup.
 */
async function pageForStep(bankId: string, stepName: string): Promise<Page> {
  const browser = await getIntegrationBrowser();
  const page = await newFixturePage(browser);
  const paths = await loadBankFixturePaths(bankId);
  await loadStep(page, paths, stepName);
  return page;
}

/**
 * Build the argument bundle HOME POST consumes, with navigation ruled out by
 * declaring the fixture page's own URL as the homepage.
 * @param page - Page holding the captured markup.
 * @returns Argument bundle for the production signal collector.
 */
function toSignalArgs(page: Page): Parameters<typeof collectLoginAreaSignals>[0] {
  const mediator = createElementMediator(page, SILENT);
  const input = { browser: some({ page }) } as unknown as IPipelineContext;
  return { mediator, input, homepageUrl: page.url(), logger: SILENT };
}

/**
 * Read the production login-form signal for one captured homepage.
 * @param page - Page holding the captured markup.
 * @returns True when the form gate resolves.
 */
async function observeLoginForm(page: Page): Promise<boolean> {
  const args = toSignalArgs(page);
  const signals = await collectLoginAreaSignals(args);
  return signals.hasLoginForm;
}

/**
 * Resolve the observed login-form signal for one bank's homepage.
 * @param bankId - Bank fixture id.
 * @returns True when the homepage already exposes a login form.
 */
async function signalsFor(bankId: string): Promise<boolean> {
  const page = await pageForStep(bankId, '01-home');
  try {
    return await observeLoginForm(page);
  } finally {
    await page.context().close();
  }
}

describe('HOME POST login-form fallback vs captured homepages (T-HOMESIG)', () => {
  beforeAll(async () => {
    await getIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await closeIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  it.each(CASES)(
    'T-HOMESIG $bankId homepage login form = $hasLoginForm',
    async (signalCase: IHomeSignalCase) => {
      const root = resolveFixtureRoot(signalCase.bankId);
      const isFixturePresent = fsSync.existsSync(root);
      if (!isFixturePresent)
        throw new ScraperError(`missing fixture root for ${signalCase.bankId}`);
      const hasLoginForm = await signalsFor(signalCase.bankId);
      expect({ bankId: signalCase.bankId, hasLoginForm }).toEqual({
        bankId: signalCase.bankId,
        hasLoginForm: signalCase.hasLoginForm,
      });
    },
    CASE_TIMEOUT_MS,
  );
});
