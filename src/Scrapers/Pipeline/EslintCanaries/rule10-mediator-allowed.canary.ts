/**
 * CANARY: Rule #10's path-based Mediator exemption, not a runtime capability.
 * This canary WILL trigger Rule #10 because it lives in EslintCanaries/ (not Mediator/).
 * That's expected — the exemption is path-based on src/Scrapers/Pipeline/Mediator/.
 *
 * This fixture documents the syntactic boundary, not sanctioned pipeline behavior.
 * The HTTP-only pipeline must not introduce page interaction.
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

/** Structural fixture for the path-based exemption; not a runtime mediator. */
export class CanaryMediatorAllowed {
  /**
   * Exercise the raw-page selector outside the exempt Mediator path.
   * @param page - Page-like handle.
   * @param selector - CSS selector.
   * @returns True after click.
   */
  public async click(page: IPageLike, selector: string): Promise<boolean> {
    await page.click(selector);
    return true;
  }
}
