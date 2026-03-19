/**
 * VisaCal pipeline config — login + builder.
 * Scrape logic in Pipeline/VisaCalScrape.ts.
 * Fully rewritten — zero imports from old VisaCal code.
 */

import type { Frame, Page } from 'playwright-core';

import {
  elementPresentOnPage,
  pageEval,
  waitUntilIframeFound,
} from '../../Common/ElementsInteractions.js';
import { CompanyTypes } from '../../Definitions.js';
import type { ScraperOptions } from '../Base/Interface.js';
import type { ILoginConfig } from '../Base/Interfaces/Config/LoginConfig.js';
import { PipelineBuilder } from '../Pipeline/PipelineBuilder.js';
import type { IPipelineDescriptor } from '../Pipeline/PipelineDescriptor.js';
import { SCRAPER_CONFIGURATION } from '../Registry/Config/ScraperConfig.js';
import { visaCalFetchData } from './Pipeline/VisaCalScrape.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];

/** Error text for invalid credentials. */
const BAD_PASSWORD = 'שם המשתמש או הסיסמה שהוזנו שגויים';

/**
 * Check if a frame is the VisaCal connect iframe.
 * @param f - Playwright frame.
 * @returns True if URL contains 'connect'.
 */
function isConnectFrame(f: Frame): boolean {
  return f.url().includes('connect');
}

/** Error selector for invalid password detection. */
const ERROR_SELECTOR = 'div.general-error > div';

/**
 * Extract inner text from a DOM element.
 * @param el - The DOM element.
 * @returns The inner text content.
 */
function extractText(el: Element): string {
  return (el as HTMLDivElement).innerText;
}

/**
 * Check if the login iframe shows invalid password error.
 * @param opts - Options with optional page.
 * @param opts.page - Browser page.
 * @returns True if error text matches.
 */
async function detectInvalidPw(opts?: { page?: Page }): Promise<boolean> {
  const page = opts?.page;
  if (!page) return false;
  try {
    const iframeOpts = { timeout: 3000, description: 'pw' };
    const frame = await waitUntilIframeFound(page, isConnectFrame, iframeOpts);
    const hasEl = await elementPresentOnPage(frame, ERROR_SELECTOR);
    if (!hasEl) return false;
    const evalOpts = { selector: ERROR_SELECTOR, defaultResult: '', callback: extractText };
    const txt = await pageEval(frame, evalOpts);
    return txt === BAD_PASSWORD;
  } catch {
    return false;
  }
}

/**
 * Check if connect iframe shows change-password form.
 * @param opts - Options with optional page.
 * @param opts.page - Browser page.
 * @returns True if detected.
 */
async function detectChangePw(opts?: { page?: Page }): Promise<boolean> {
  const page = opts?.page;
  if (!page) return false;
  try {
    const frame = await waitUntilIframeFound(page, isConnectFrame, {
      timeout: 3000,
      description: 'cp',
    });
    return await elementPresentOnPage(frame, '.change-password-subtitle');
  } catch {
    return false;
  }
}

/** VisaCal login config — new architecture. */
const VISACAL_LOGIN: ILoginConfig = {
  loginUrl: CFG.urls.base || '',
  fields: [
    { credentialKey: 'username', selectors: [] },
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [{ kind: 'css', value: 'button[type="submit"]' }],
  /**
   * Wait for login link visibility.
   * @param page - Browser page.
   */
  checkReadiness: async page => {
    const link = page.getByText('כניסה לחשבון').first();
    await link.waitFor({ state: 'visible', timeout: 30000 });
  },
  /**
   * Open connect iframe for login.
   * @param page - Browser page.
   * @returns The login iframe.
   */
  preAction: async (page): Promise<Frame | undefined> => {
    const link = page.getByText('כניסה לחשבון').first();
    await link.click();
    const iframeOpts = { timeout: 45000, description: 'login iframe' };
    const frame = await waitUntilIframeFound(page, isConnectFrame, iframeOpts);
    const inner = frame.getByText('כניסה').first();
    await inner.click();
    return frame;
  },
  /**
   * Wait for dashboard redirect.
   * @param page - Browser page.
   */
  postAction: async page => {
    const dashPattern = /dashboard|cal-online\.co\.il\/#/;
    await page.waitForURL(dashPattern, { timeout: 30000 });
  },
  possibleResults: {
    success: [/dashboard/i, /cal-online\.co\.il\/#/],
    invalidPassword: [detectInvalidPw],
    changePassword: [detectChangePw],
  },
};

/**
 * Build the VisaCal pipeline descriptor.
 * @param options - Scraper options.
 * @returns Pipeline: init → login → dashboard → scrape → terminate.
 */
function buildVisaCalPipeline(options: ScraperOptions): IPipelineDescriptor {
  return new PipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(VISACAL_LOGIN)
    .withDashboard()
    .withScraper(visaCalFetchData)
    .build();
}

export default buildVisaCalPipeline;
export { buildVisaCalPipeline };
