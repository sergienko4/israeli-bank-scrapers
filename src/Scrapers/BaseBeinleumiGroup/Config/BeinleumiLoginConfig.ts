import { type Frame, type Page } from 'playwright-core';

import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { OptionalFramePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { DOM_OTP } from '../../Registry/Config/ScraperConfigDefaults.js';
import { buildDashboardWaiters } from '../BaseBeinleumiGroupHelpers.js';

/**
 * Wait for any of the known post-login dashboard selectors to appear.
 * @param page - The Playwright page to check for dashboard elements.
 * @returns True once the race completes.
 */
async function beinleumiPostAction(
  page: Page,
): ReturnType<NonNullable<ILoginConfig['postAction']>> {
  const waiters = buildDashboardWaiters(page);
  if (waiters.length > 0) {
    await Promise.race(waiters).catch((error: unknown) => {
      if (!(error instanceof Error && error.name === 'TimeoutError')) throw error;
    });
  }
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

/** Delay before retrying login frame detection (ms). */
const FRAME_RETRY_DELAY_MS = 2000;

/**
 * Wait for iframes to appear, then find the login frame with up to 3 retries.
 * @param page - The Playwright page to interact with.
 * @returns The login iframe if found, or undefined on timeout.
 */
async function beinleumiPreAction(page: Page): ReturnType<NonNullable<ILoginConfig['preAction']>> {
  await waitForAnyIframe(page);
  const first = await findLoginFrame(page);
  if (first) return first;
  await page.waitForTimeout(FRAME_RETRY_DELAY_MS);
  const second = await findLoginFrame(page);
  if (second) return second;
  await page.waitForTimeout(FRAME_RETRY_DELAY_MS);
  return findLoginFrame(page);
}

/**
 * Wait for any iframe to appear in the DOM.
 * @param page - The Playwright page.
 * @returns True if an iframe appeared, false on timeout.
 */
async function waitForAnyIframe(page: Page): Promise<boolean> {
  return page
    .waitForFunction(() => document.querySelectorAll('iframe').length > 0, {
      timeout: FRAME_POLL_DEADLINE_MS,
    })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Check if a frame contains login credential fields.
 * Detects login frames by presence of 2+ text inputs (username + password).
 * @param frame - The frame to check.
 * @returns True if the frame has multiple credential inputs.
 */
async function checkFrameHasLoginFields(frame: Frame): Promise<boolean> {
  const count = await frame
    .getByRole('textbox')
    .count()
    .catch((): number => 0);
  return count >= 2;
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
