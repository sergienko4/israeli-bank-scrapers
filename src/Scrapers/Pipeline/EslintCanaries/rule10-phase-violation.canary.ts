/**
 * CANARY: Rule #10 violation — Phase file using Playwright directly.
 * This file MUST trigger ESLint errors. If it passes, the guardrail is dead.
 *
 * Expected errors:
 *   1. no-restricted-syntax: Direct call to 'page' is forbidden in Phases
 *   2. Any import of @playwright/test is forbidden in Pipeline logic
 */

import type { Page } from 'playwright-core';

/** Canary phase that violates Rule #10 — direct Playwright usage. */
export class CanaryPhaseViolation {
  /**
   * BAD: calls page.click directly instead of using mediator.
   * @param page - Playwright page (should not be used directly).
   * @returns True after click.
   */
  public async execute(page: Page): Promise<boolean> {
    await page.click('.submit');
    return true;
  }
}
