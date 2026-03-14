/**
 * Shared helpers for selector-fallback real e2e tests.
 * Imported by each per-bank test file (run in parallel by Jest).
 */
import { type Page } from 'playwright-core';

import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser.js';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';

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
 * Regex matching "Could not find '<key>' field" for the given credential keys.
 * @param keys - credential key names to match
 * @returns regex pattern matching any of the given keys
 */
export function selectorErrorFor(...keys: string[]): RegExp {
  return new RegExp(`Could not find '(${keys.join('|')})' field`);
}

/**
 * Inject the login form (identified by a visible input inside it) into a
 * same-origin srcdoc iframe, then remove the form from the main page.
 * Simulates a bank that moved its login form into an iframe.
 * @param page - The Playwright page.
 * @param inputSelector - CSS selector for an input inside the form.
 * @returns True after the form has been injected.
 */
export async function injectFormByInput(page: Page, inputSelector: string): Promise<boolean> {
  await page.evaluate(sel => {
    const form = document.querySelector<HTMLElement>(sel)?.closest('form');
    if (!form) return;
    const iframe = document.createElement('iframe');
    iframe.srcdoc = `<html><head><base target="_top"></head><body>${form.outerHTML}</body></html>`;
    form.parentElement?.insertBefore(iframe, form);
    form.remove();
  }, inputSelector);
  await page.waitForTimeout(1500);
  return true;
}
