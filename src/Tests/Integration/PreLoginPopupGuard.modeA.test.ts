/**
 * T-GUARD — PRE-LOGIN dismissal decision against REAL captured bank markup.
 *
 * <p>This is the layer that was missing. Three regressions shipped across
 * 8.6.0 → 8.6.1 (Max's backdrop, VisaCal's widget close, Amex's login UI) and
 * none was caught, because the dismissal decision was only ever exercised
 * against hand-written stub mediators. Here it runs through the PRODUCTION
 * resolver against the committed pre-login snapshots.
 *
 * <p>HARNESS LIMIT — {@link loadStep} replays a snapshot via `setContent`,
 * which reconstructs the MAIN FRAME only. Banks whose login lives in a
 * cross-origin child iframe (VisaCal: `connect.cal-online.co.il/send-otp`)
 * cannot be modelled here; their `widget-frame` veto is covered at the unit
 * layer in `Unit/Pipeline/Interceptors/PopupInterceptorPreLogin.test.ts`.
 * VisaCal is deliberately absent from {@link EXPECTED_VETO} rather than
 * asserted with a value the harness cannot legitimately produce.
 *
 * <p>Test Case IDs:
 *   - T-GUARD-1 (FIRING): Amex / Isracard / Hapoalim veto with
 *     `login-form-visible`. Fails if the login-form veto is dropped — the
 *     exact 8.6.1 regression.
 *   - T-GUARD-2: Max does NOT veto, so its marketing backdrop is still
 *     cleared. Fails if the guard over-blocks — the 8.6.0 regression.
 */

import * as fsSync from 'node:fs';

import type { Page } from 'playwright-core';

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import type { LoginUiVeto } from '../../Scrapers/Pipeline/Interceptors/PreLoginDismissGuard.js';
import { resolveLoginUiVeto } from '../../Scrapers/Pipeline/Interceptors/PreLoginDismissGuard.js';
import createElementMediator from '../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import type { ScraperLogger } from '../../Scrapers/Pipeline/Types/Debug.js';
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

/**
 * `[bankId, capturedStepName, expectedVeto]`.
 *
 * `false` means "dismissal proceeds" — the obstruction is a host-page overlay
 * and no login UI is on screen.
 */
const EXPECTED_VETO: readonly (readonly [string, string, LoginUiVeto])[] = [
  ['amex', '02-pre-login', 'login-form-visible'],
  ['isracard', '02-pre-login', 'login-form-visible'],
  ['hapoalim', '02-pre-login', 'login-form-visible'],
  ['discount', '02-pre-login', 'login-form-visible'],
  ['max', '02-after-entry', false],
];

/** Silent logger — assertions carry the diagnostics. */
const SILENT: ScraperLogger = {
  /**
   * No-op debug.
   * @returns True.
   */
  debug: (): boolean => true,
  /**
   * No-op trace.
   * @returns True.
   */
  trace: (): boolean => true,
  /**
   * No-op info.
   * @returns True.
   */
  info: (): boolean => true,
  /**
   * No-op warn.
   * @returns True.
   */
  warn: (): boolean => true,
  /**
   * No-op error.
   * @returns True.
   */
  error: (): boolean => true,
} as unknown as ScraperLogger;

/**
 * Build the minimal pipeline context the guard reads — mediator + page.
 * @param page - Fixture page holding the captured markup.
 * @returns Context accepted by {@link resolveLoginUiVeto}.
 */
function toGuardContext(page: Page): IPipelineContext {
  const mediator = createElementMediator(page, SILENT);
  return { mediator: some(mediator), browser: some({ page }) } as unknown as IPipelineContext;
}

/**
 * Load a captured step into a fresh fixture page.
 * @param bankId - Bank fixture id.
 * @param stepName - Captured step representing the PRE-LOGIN moment.
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
 * Resolve the guard's verdict against a captured step.
 * @param bankId - Bank fixture id.
 * @param stepName - Captured step representing the PRE-LOGIN moment.
 * @returns The guard's veto decision.
 */
async function vetoForFixture(bankId: string, stepName: string): Promise<LoginUiVeto> {
  const page = await pageForStep(bankId, stepName);
  const ctx = toGuardContext(page);
  try {
    return await resolveLoginUiVeto(ctx, 'pre-login');
  } finally {
    await page.context().close();
  }
}

describe('PRE-LOGIN dismissal guard vs captured bank markup (T-GUARD)', () => {
  beforeAll(async () => {
    await getIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await closeIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  it.each(EXPECTED_VETO)(
    'T-GUARD %s @ %s → veto=%s',
    async (bankId, stepName, expected) => {
      const root = resolveFixtureRoot(bankId);
      const isFixturePresent = fsSync.existsSync(root);
      if (!isFixturePresent) throw new ScraperError(`missing fixture root for ${bankId}`);
      const veto = await vetoForFixture(bankId, stepName);
      expect({ bankId, veto }).toEqual({ bankId, veto: expected });
    },
    CASE_TIMEOUT_MS,
  );
});
