/**
 * CANARY: Rule #10 violation — Pipeline business logic calling Playwright.
 * This file MUST trigger ESLint errors. If it passes, the guardrail is dead.
 *
 * canary-expects-rule: no-restricted-syntax
 *
 * Expected error:
 *   no-restricted-syntax — `page.click(...)` below is a direct call on an
 *   identifier named `page`, which Rule #10 forbids in Pipeline business
 *   logic (Phases/Core/Banks/Registry/Logging). Browser access belongs to the
 *   Mediator; those layers must go through `ctx.mediator`.
 *
 * WHAT THIS CANARY DOES *NOT* PROVE — two honest limits:
 *   1. Self-certification. This file's own path is listed in the §21 `files`
 *      array (the house convention for canaries), so it stays green even if
 *      every PRODUCTION glob were deleted from that array. It proves the rule
 *      still exists; it does not prove the rule still reaches production.
 *   2. Rule granularity. `canary-expects-rule` names the shared ESLint rule
 *      `no-restricted-syntax`, not the Rule #10 selector specifically — any
 *      other selector in that array could satisfy the check.
 * Both are properties of the canary harness, not of this fixture. Closing them
 * needs a dedicated rule ID; tracked with the type-aware-rule follow-up noted
 * on RULE10_NO_RAW_PAGE_RULE in eslint.config.mjs.
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
