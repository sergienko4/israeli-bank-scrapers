/**
 * PR.YML / SafeScreenshot.ts drift pin.
 *
 * Background: PR #248 (commit `bf53b906`, 2026-05-21) shipped a blanket
 * `if (process.env.CI) return false` in `SafeScreenshot.ts` while the
 * GitHub Actions workflow `.github/workflows/pr.yml` continued to advertise
 * a documented "init + home only" pre-auth screenshot policy. The two
 * surfaces silently disagreed for 10 days, leaving every CI HOME-PRE
 * failure (e.g. Hapoalim `no login nav link found`) without any visual
 * evidence — root-cause investigations stalled because nobody had a
 * screenshot of the rendered page.
 *
 * This pin re-binds the two surfaces: the only source of truth for the
 * allowlist lives in `PRE_AUTH_SCREENSHOT_PHASES`, and `pr.yml` is
 * required to reference both allowed phase names verbatim in the comment
 * block above the diagnostics upload step. Any drift (workflow tweak
 * removing the comment, code tweak adding/removing a phase) trips the pin
 * and forces both surfaces to move together.
 *
 * See `src/Common/SafeScreenshot.ts` for the canonical policy + helper.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import { PRE_AUTH_SCREENSHOT_PHASES, safeScreenshot } from '../../../Common/SafeScreenshot.js';

const REPO_ROOT = process.cwd();
const PR_YML_PATH = resolve(REPO_ROOT, '.github', 'workflows', 'pr.yml');
const ORIGINAL_CI = process.env.CI;

/**
 * Creates a mock Playwright Page exposing only `screenshot` as a jest mock.
 * @returns An object exposing the screenshot mock and the Page-typed view.
 */
function makeMockPage(): { page: Page; screenshotMock: jest.Mock } {
  const emptyBuffer = Buffer.alloc(0);
  const screenshotMock = jest.fn().mockResolvedValue(emptyBuffer);
  const page = { screenshot: screenshotMock } as unknown as Page;
  return { page, screenshotMock };
}

describe('CI screenshot policy — pr.yml ↔ SafeScreenshot drift pin', () => {
  const prYml = readFileSync(PR_YML_PATH, 'utf8');

  it('pr.yml documents the exact pre-auth allowlist phrase', () => {
    const hasOnlyPhrase = prYml.includes('Pre-auth screenshots (init/home only)');
    const hasTriagePhrase = prYml.includes('homepage WAF / challenge-wall failures');
    const hasExclusionPhrase = prYml.includes(
      'LOGIN / OTP / DASHBOARD / SCRAPE screenshots remain excluded',
    );
    expect(hasOnlyPhrase).toBe(true);
    expect(hasTriagePhrase).toBe(true);
    expect(hasExclusionPhrase).toBe(true);
  });

  it('pr.yml mentions every allowed phase verbatim in the diagnostics path block', () => {
    for (const phase of PRE_AUTH_SCREENSHOT_PHASES) {
      const hasPhase = prYml.includes(phase);
      expect(hasPhase).toBe(true);
    }
  });

  it('PRE_AUTH_SCREENSHOT_PHASES is the only contract — locked at init + home', () => {
    const phases = [...PRE_AUTH_SCREENSHOT_PHASES];
    expect(phases).toEqual(['init', 'home']);
  });

  describe('every PhaseName from the runtime maps to the correct CI gate verdict', () => {
    beforeEach(() => {
      process.env.CI = 'true';
    });
    afterEach(() => {
      if (ORIGINAL_CI === undefined) delete process.env.CI;
      else process.env.CI = ORIGINAL_CI;
      jest.clearAllMocks();
    });

    const expectations: readonly (readonly [string, boolean])[] = [
      ['hapoalim-init-pre-done-20260531.png', true],
      ['hapoalim-init-action-fail-20260531.png', true],
      ['hapoalim-home-pre-fail-20260531.png', true],
      ['hapoalim-home-final-done-20260531.png', true],
      ['hapoalim-prelogin-pre-done-20260531.png', false],
      ['hapoalim-login-pre-done-20260531.png', false],
      ['hapoalim-login-action-done-20260531.png', false],
      ['hapoalim-otp-pre-done-20260531.png', false],
      ['isracard-auth-discovery-post-fail-20260531.png', false],
      ['discount-account-resolve-pre-done-20260531.png', false],
      ['max-dashboard-pre-done-20260531.png', false],
      ['visacal-scrape-final-done-20260531.png', false],
      ['amex-terminate-pre-done-20260531.png', false],
    ];

    for (const [file, isExpectedAllowed] of expectations) {
      it(`policy maps "${file}" → ${String(isExpectedAllowed)}`, async () => {
        const { page, screenshotMock } = makeMockPage();
        const didCapture = await safeScreenshot(page, { path: file, fullPage: false });
        expect(didCapture).toBe(isExpectedAllowed);
        expect(screenshotMock).toHaveBeenCalledTimes(isExpectedAllowed ? 1 : 0);
      });
    }
  });
});
