/**
 * Cross-bank LOGIN.POST scope-intact OTP-screen guard (Mode A — static HTML).
 *
 * <p>Regression guard for the PR #282 (commit 97ca1353) false-positive:
 * the scope-intact disambiguator read the always-coresident SMS-lobby and
 * password-submit buttons as a rendered OTP screen, masking a failed AMEX
 * login as success and killing retry-recovery (→ failEmpty).
 *
 * <p>For each bank whose login screen shows a coresident "send SMS code"
 * lobby (password field still visible, NO genuine one-time-code input
 * yet), {@link otpScreenVisible} MUST return `false`: the lobby is NOT a
 * post-password OTP screen. Generic structural trigger buttons
 * (`//button[@type="submit"]`, `//form//button`) are NOT a trustworthy
 * "OTP rendered" signal — only a real OTP CODE INPUT is.
 *
 * <p>RED before the fix (otpScreenVisible returns `true` via the trigger
 * probe matching the visible lobby buttons); GREEN after (only a genuine
 * code input counts as a rendered OTP screen).
 *
 * <p>Test Case IDs:
 *   - SCOPE-OTP-LOBBY-001 (amex):     coresident SMS lobby ≠ OTP screen
 *   - SCOPE-OTP-LOBBY-002 (isracard): coresident SMS lobby ≠ OTP screen
 */

import * as fsSync from 'node:fs';

import type { Browser, Page } from 'playwright-core';

import { createElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { otpScreenVisible } from '../../../../Scrapers/Pipeline/Mediator/Login/ScopeIntact/ScopeIntactOtp.js';
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

const BROWSER_BOOT_TIMEOUT_MS = 120000;
const STEP_TIMEOUT_MS = 60000;

/** A bank whose login screen shows a coresident SMS lobby (not an OTP screen). */
interface ICoresidentLobbyBank {
  readonly testId: string;
  readonly bankId: string;
  readonly lobbyStep: string;
}

/** Cross-bank matrix — config-driven (OCP), no per-bank duplication. */
const CORESIDENT_LOBBY_BANKS: readonly ICoresidentLobbyBank[] = [
  { testId: 'SCOPE-OTP-LOBBY-001', bankId: 'amex', lobbyStep: '03-after-flip' },
  { testId: 'SCOPE-OTP-LOBBY-002', bankId: 'isracard', lobbyStep: '03-after-flip' },
];

/**
 * Whether a bank's fixture root exists; skip that row otherwise.
 * @param bankId - Bank fixture id.
 * @returns true when fixtures present on disk.
 */
function fixtureRootExistsSync(bankId: string): boolean {
  const root = resolveFixtureRoot(bankId);
  return fsSync.existsSync(root);
}

/**
 * Assert the loaded lobby fixture is not read as a rendered OTP screen.
 * The coresident SMS-lobby / password-submit buttons must NOT count —
 * only a genuine OTP code input does.
 * @param page - Page with the lobby fixture loaded.
 */
async function assertLobbyNotOtpScreen(page: Page): Promise<void> {
  const mediator = createElementMediator(page);
  const visibility = await otpScreenVisible(mediator);
  expect(visibility).toBe(false);
}

/**
 * Load a bank's lobby fixture into a fresh page and run the guard.
 * @param browser - Shared integration browser.
 * @param bank - Coresident-lobby bank descriptor.
 */
async function driveLobbyGuard(browser: Browser, bank: ICoresidentLobbyBank): Promise<void> {
  const page = await newFixturePage(browser);
  try {
    const paths = await loadBankFixturePaths(bank.bankId);
    await loadStep(page, paths, bank.lobbyStep);
    await assertLobbyNotOtpScreen(page);
  } finally {
    await closeQuietly(page);
  }
}

describe('LOGIN.POST scope-intact — coresident SMS lobby is NOT an OTP screen', () => {
  beforeAll(async () => {
    await getIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await closeIntegrationBrowser();
  });

  describe.each(CORESIDENT_LOBBY_BANKS)('$bankId ($testId)', (bank: ICoresidentLobbyBank) => {
    const itOrSkip = fixtureRootExistsSync(bank.bankId) ? it : it.skip;

    itOrSkip(
      'coresident SMS lobby is not read as a rendered OTP screen',
      async () => {
        const browser = await getIntegrationBrowser();
        await driveLobbyGuard(browser, bank);
      },
      STEP_TIMEOUT_MS,
    );
  });
});
