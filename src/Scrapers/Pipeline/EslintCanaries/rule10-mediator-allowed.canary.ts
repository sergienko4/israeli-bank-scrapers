/**
 * CANARY: Rule #10 success case — Mediator IS allowed to use Playwright.
 * This canary WILL trigger Rule #10 because it lives in EslintCanaries/ (not Mediator/).
 * That's expected — the exemption is path-based on src/Scrapers/Pipeline/Mediator/.
 *
 * Real validation: `npx eslint src/Scrapers/Pipeline/Mediator/CreateElementMediator.ts`
 * must pass with zero Rule #10 errors. If it doesn't, the Mediator exemption is broken.
 *
 * This file exists as documentation of the boundary, not as an active canary.
 */

import type { Page } from 'playwright-core';

/** Canary mediator — allowed to use Playwright directly. */
export class CanaryMediatorAllowed {
  /**
   * OK: Mediator infrastructure is allowed to call page methods.
   * @param page - Playwright page.
   * @param selector - CSS selector.
   * @returns True after click.
   */
  public async click(page: Page, selector: string): Promise<boolean> {
    await page.click(selector);
    return true;
  }
}
