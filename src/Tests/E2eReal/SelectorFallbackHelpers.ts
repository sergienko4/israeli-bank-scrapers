/**
 * Shared helpers for selector-fallback real e2e tests.
 * Imported by each per-bank test file (run in parallel by Jest).
 */
import { type Page } from 'playwright';

import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';

/** Valid errorType values that prove the bank was reached (not a selector error). */
export const VALID_REACHED_BANK: string[] = [
  LOGIN_RESULTS.InvalidPassword,
  LOGIN_RESULTS.UnknownError,
  ScraperErrorTypes.WafBlocked,
  ScraperErrorTypes.Timeout,
  ScraperErrorTypes.Generic,
  // Banks that now require OTP still prove the bank was reached
  ScraperErrorTypes.TwoFactorRetrieverMissing,
];

/**
 * Builds a regex matching "Could not find '&lt;key&gt;' field" for the given credential keys.
 *
 * @param keys - the credential key names to include in the pattern
 * @returns a RegExp that matches the selector-not-found error message
 */
export function selectorErrorFor(...keys: string[]): RegExp {
  return new RegExp(`Could not find '(${keys.join('|')})' field`);
}

/**
 * Injects the login form identified by a visible input into a same-origin srcdoc iframe,
 * then removes the form from the main page to simulate a bank that moved its login form.
 *
 * @param page - the Playwright page whose form to inject into an iframe
 * @param inputSelector - CSS selector identifying an input inside the form to inject
 */
export async function injectFormByInput(page: Page, inputSelector: string): Promise<void> {
  await page.evaluate(sel => {
    const form = document.querySelector<HTMLElement>(sel)?.closest('form');
    if (!form) return;
    const iframe = document.createElement('iframe');
    iframe.srcdoc = `<html><head><base target="_top"></head><body>${form.outerHTML}</body></html>`;
    form.parentElement?.insertBefore(iframe, form);
    form.remove();
  }, inputSelector);
  await page.waitForTimeout(1500);
}
