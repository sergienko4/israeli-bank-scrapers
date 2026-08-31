/**
 * CANARY: Rule #10 violation — Pipeline business logic calling Playwright.
 * This file MUST trigger ESLint errors. If it passes, the guardrail is dead.
 *
 * Expected error:
 *   no-restricted-syntax — `page.click(...)` below is a direct call on an
 *   identifier named `page`, which Rule #10 forbids in Pipeline business
 *   logic (Phases/Core/Banks/Registry/Logging). Browser access belongs to the
 *   Mediator; those layers must go through `ctx.mediator`.
 *
 * WHAT THIS CANARY DOES *NOT* PROVE — one honest limit:
 *   Self-certification. This file's own path is listed in the §21 `files`
 *   array (the house convention for canaries), so it stays green even if
 *   every PRODUCTION glob were deleted from that array. It proves the rule
 *   still exists; it does not prove the rule still reaches production.
 *   That gap is closed separately by assert-rule10-boundary.cjs, which reads
 *   the resolved config for a real Phase file, a Mediator file and the §21a
 *   grandfather — so arming, exemption and grandfather are each asserted
 *   against production paths rather than against this fixture.
 *
 * Rule granularity used to be a second limit: `canary-expects-rule` names the
 * shared rule `no-restricted-syntax`, so any of its ~58 selectors could have
 * satisfied it. The `canary-expects-message` pair below pins the match to
 * Rule #10's own message, which the harness now requires for this rule.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: Rule #10
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
