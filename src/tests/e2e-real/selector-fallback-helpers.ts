/**
 * Shared helpers for selector-fallback real e2e tests.
 * Imported by each per-bank test file (run in parallel by Jest).
 */
import { type Page } from 'playwright';
import { LoginResults } from '../../scrapers/base-scraper-with-browser';
import { ScraperErrorTypes } from '../../scrapers/errors';

/** Valid errorType values that prove the bank was reached (not a selector error). */
export const VALID_REACHED_BANK: string[] = [
  LoginResults.InvalidPassword,
  LoginResults.UnknownError,
  ScraperErrorTypes.WafBlocked,
  ScraperErrorTypes.Timeout,
  ScraperErrorTypes.General,
  // Banks that now require OTP still prove the bank was reached
  ScraperErrorTypes.TwoFactorRetrieverMissing,
];

/** Regex matching "Could not find '<key>' field" for the given credential keys. */
export function selectorErrorFor(...keys: string[]): RegExp {
  return new RegExp(`Could not find '(${keys.join('|')})' field`);
}

/**
 * Inject the login form (identified by a visible input inside it) into a
 * same-origin srcdoc iframe, then remove the form from the main page.
 * Simulates a bank that moved its login form into an iframe.
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
