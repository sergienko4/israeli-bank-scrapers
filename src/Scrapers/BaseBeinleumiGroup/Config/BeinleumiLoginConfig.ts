import { type Frame, type Page } from 'playwright-core';

import { getDebug } from '../../../Common/Debug.js';
import { type ILoginConfig } from '../../Base/Config/LoginConfig.js';
import type { OptionalFramePromise } from '../../Base/Interfaces/CallbackTypes.js';
import { DOM_OTP } from '../../Registry/Config/ScraperConfigDefaults.js';
import { buildDashboardWaiters } from '../BaseBeinleumiGroupHelpers.js';

const LOG = getDebug('beinleumi-login');

/** Maximum time (ms) to wait for the login frame to appear. */
const FRAME_POLL_DEADLINE_MS = 15000;

/** Hebrew text of the login button on the homepage. */
const LOGIN_BUTTON_TEXT = 'כניסה לחשבונך';

/** URL fragments that identify Mataf login/OTP iframes. */
const MATAF_LOGIN_URL = 'MatafLoginService';
const MATAF_APPROVE_URL = 'MatafMobileApproveServlet';

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

/** Login field declarations for Beinleumi — wellKnown resolves via "קוד משתמש" and "סיסמה". */
export const BEINLEUMI_FIELDS: ILoginConfig['fields'] = [
  { credentialKey: 'username', selectors: [] },
  { credentialKey: 'password', selectors: [] },
];

const BEINLEUMI_SUBMIT: ILoginConfig['submit'] = [
  { kind: 'ariaLabel', value: 'כניסה' },
  { kind: 'clickableText', value: 'כניסה' },
  { kind: 'clickableText', value: 'המשך' },
];

const BEINLEUMI_POSSIBLE_RESULTS: ILoginConfig['possibleResults'] = {
  success: [/fibi.*accountSummary/, /Resources\/PortalNG\/shell/, /FibiMenu\/Online/],
  invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
};

/**
 * Click "כניסה לחשבונך" on the homepage to load the Mataf login iframe.
 * The homepage at fibi.co.il/private/ has this as an `<a href="#">` link.
 * @param page - The Playwright page to interact with.
 * @returns True if the login button was clicked.
 */
async function activateLoginArea(page: Page): Promise<boolean> {
  const pageUrl = page.url().slice(0, 60);
  LOG.debug('activating login on %s', pageUrl);
  const link = page.getByText(LOGIN_BUTTON_TEXT, { exact: true }).last();
  const isVisible = await link.isVisible().catch((): boolean => false);
  if (!isVisible) {
    LOG.debug('login button not found on homepage');
    return false;
  }
  LOG.debug('clicking "%s"', LOGIN_BUTTON_TEXT);
  await link.click();
  await page.waitForTimeout(2000);
  return true;
}

/**
 * Browser-side predicate: does any iframe src contain one of the URL fragments?
 * Passed to page.waitForFunction to poll without await-in-loop.
 * @param urls - The URL fragments to search for.
 * @returns True if any iframe matches.
 */
function hasIframeMatchingAny(urls: string[]): boolean {
  const nodeList = document.querySelectorAll('iframe');
  const iframes = Array.from(nodeList);
  return iframes.some(f => urls.some(u => f.src.includes(u)));
}

/** Both Mataf URL fragments to watch for. */
const MATAF_URLS = [MATAF_LOGIN_URL, MATAF_APPROVE_URL];

/**
 * Check if a frame URL matches any Mataf pattern.
 * @param frameUrl - The frame URL to check.
 * @returns True if it matches a Mataf URL.
 */
function isMatafUrl(frameUrl: string): boolean {
  return MATAF_URLS.some(u => frameUrl.includes(u));
}

/**
 * Get the first Mataf frame from the page.
 * @param page - The Playwright page.
 * @returns The Mataf frame if found, otherwise the find() result when no match.
 */
function findMatafFrame(page: Page): ReturnType<Frame[]['find']> {
  const frames = page.frames();
  return frames.find(f => {
    const url = f.url();
    return isMatafUrl(url);
  });
}

/**
 * Wait for the Mataf login iframe to appear, then return it.
 * If no Mataf frame appears, returns undefined — the SelectorResolverPipeline
 * will search all iframes automatically in Round 1.
 * @param page - The Playwright page.
 * @returns The Mataf login frame or undefined.
 */
async function waitForLoginFrame(page: Page): OptionalFramePromise {
  const existing = findMatafFrame(page);
  if (existing) return existing;
  await page
    .waitForFunction(hasIframeMatchingAny, MATAF_URLS, { timeout: FRAME_POLL_DEADLINE_MS })
    .then((): true => true)
    .catch((): false => false);
  const result = findMatafFrame(page);
  if (result) {
    const frameUrl = result.url().slice(0, 80);
    LOG.debug('found login frame: %s', frameUrl);
  } else {
    LOG.debug('Mataf frame not found — resolver will search all frames');
  }
  return result;
}

/**
 * Activate login area, then find the login iframe.
 * Flow: homepage → click "כניסה לחשבונך" → wait for Mataf login iframe.
 * @param page - The Playwright page to interact with.
 * @returns The login iframe for credential filling.
 */
async function beinleumiPreAction(page: Page): ReturnType<NonNullable<ILoginConfig['preAction']>> {
  await activateLoginArea(page);
  return waitForLoginFrame(page);
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
