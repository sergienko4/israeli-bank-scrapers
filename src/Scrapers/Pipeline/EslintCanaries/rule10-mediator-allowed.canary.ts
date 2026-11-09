/**
 * CANARY: Rule #10 success case — Mediator IS allowed to drive a browser page.
 * This canary WILL trigger Rule #10 because it lives in EslintCanaries/ (not Mediator/).
 * That's expected — the exemption is path-based on src/Scrapers/Pipeline/Mediator/.
 *
 * This file exists as documentation of the boundary, not as an active canary.
 * It uses a structural page stand-in so the guardrail has no dependency on a
 * browser package.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: Rule #10
 */

/** Structural page handle; the rule keys on the identifier, not the type. */
interface IPageLike {
  click(selector: string): Promise<unknown>;
}

/** Canary mediator — allowed to drive the page directly. */
export class CanaryMediatorAllowed {
  /**
   * OK: Mediator infrastructure is allowed to call page methods.
   * @param page - Page-like handle.
   * @param selector - CSS selector.
   * @returns True after click.
   */
  public async click(page: IPageLike, selector: string): Promise<boolean> {
    await page.click(selector);
    return true;
  }
}
