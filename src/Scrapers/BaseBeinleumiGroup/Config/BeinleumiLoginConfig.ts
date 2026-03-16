import { type Frame, type Page } from 'playwright-core';

import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { OptionalFramePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { DOM_OTP } from '../../Registry/Config/ScraperConfigDefaults.js';
import { WELL_KNOWN_DASHBOARD_SELECTORS } from '../../Registry/WellKnownSelectors.js';

/**
 * Build text-based waiters from WELL_KNOWN dashboard categories.
 * @param page - The Playwright page to build waiters for.
 * @returns Array of promises that resolve when a dashboard element is visible.
 */
function buildDashboardWaiters(page: Page): Promise<boolean>[] {
  const candidates = [
    ...WELL_KNOWN_DASHBOARD_SELECTORS.logoutLink,
    ...WELL_KNOWN_DASHBOARD_SELECTORS.accountSelector,
    ...WELL_KNOWN_DASHBOARD_SELECTORS.dashboardIndicator,
  ];
  return candidates
    .filter(c => c.kind === 'textContent')
    .map(async c => {
      const loc = page.getByText(c.value).first();
      await loc.waitFor({ state: 'visible', timeout: 30000 });
      return true;
    });
}

/**
 * Wait for any of the known post-login dashboard selectors to appear.
 * @param page - The Playwright page to check for dashboard elements.
 * @returns True once the race completes.
 */
async function beinleumiPostAction(
  page: Page,
): ReturnType<NonNullable<ILoginConfig['postAction']>> {
  const waiters = buildDashboardWaiters(page);
  if (waiters.length === 0) return;
  await Promise.race(waiters).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'TimeoutError') return;
    throw error;
  });
}

/** Login field declarations for Beinleumi — wellKnown resolves #username and #password. */
export const BEINLEUMI_FIELDS: ILoginConfig['fields'] = [
  { credentialKey: 'username', selectors: [] }, // wellKnown → #username
  { credentialKey: 'password', selectors: [] }, // wellKnown → #password
];

const BEINLEUMI_SUBMIT: ILoginConfig['submit'] = [
  { kind: 'clickableText', value: 'המשך' },
  { kind: 'clickableText', value: 'כניסה' },
];

const BEINLEUMI_POSSIBLE_RESULTS: ILoginConfig['possibleResults'] = {
  success: [/fibi.*accountSummary/, /Resources\/PortalNG\/shell/, /FibiMenu\/Online/],
  invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
};

/**
 * Click the login trigger if present, then wait for the form to render.
 * @param page - The Playwright page to interact with.
 * @returns The login iframe if found, or undefined.
 */
/** Maximum time (ms) to wait for the login frame to appear. */
const FRAME_POLL_DEADLINE_MS = 15000;

/**
 * Wait for the login iframe to appear, then find and return it.
 * Uses browser-level waitForFunction to detect password input in any frame.
 * @param page - The Playwright page to interact with.
 * @returns The login iframe if found within deadline.
 */
async function beinleumiPreAction(page: Page): ReturnType<NonNullable<ILoginConfig['preAction']>> {
  await page
    .waitForFunction(() => document.querySelectorAll('iframe').length > 0, {
      timeout: FRAME_POLL_DEADLINE_MS,
    })
    .catch(() => false);
  return findLoginFrame(page);
}

/**
 * Check if a frame contains login credential fields (password input).
 * @param frame - The frame to check.
 * @returns True if the frame has a password input (strong login indicator).
 */
async function checkFrameHasLoginFields(frame: Frame): Promise<boolean> {
  const passwordCount = await frame
    .locator('input[type="password"]')
    .count()
    .catch((): number => 0);
  return passwordCount > 0;
}

/**
 * Find the login iframe by content.
 * @param page - The Playwright page to search.
 * @returns The login frame, or undefined if not found.
 */
async function findLoginFrame(page: Page): OptionalFramePromise {
  const frames = page.frames();
  const tasks = frames.map(checkFrameHasLoginFields);
  const checks = await Promise.all(tasks);
  const idx = checks.findIndex(Boolean);
  if (idx >= 0) return frames[idx];
  return frames.find(f => f.url().includes('login'));
}

/**
 * Build the login configuration for Beinleumi bank.
 * @param loginUrl - The bank's login page URL.
 * @returns A complete ILoginConfig for the Beinleumi login flow.
 */
export function beinleumiConfig(loginUrl: string): ILoginConfig {
  return {
    loginUrl,
    fields: BEINLEUMI_FIELDS,
    submit: BEINLEUMI_SUBMIT,
    otp: DOM_OTP,
    preAction: beinleumiPreAction,
    postAction: beinleumiPostAction,
    possibleResults: BEINLEUMI_POSSIBLE_RESULTS,
  };
}
