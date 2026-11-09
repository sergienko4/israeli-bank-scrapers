/**
 * ESLint canary — no-direct-screenshot.
 *
 * canary-expects-rule: no-restricted-syntax
 * canary-expects-message: rendered bank pixels
 */

// Canary: NO_DIRECT_SCREENSHOT — any `page.screenshot()` call can leak
// rendered post-auth bank pixels into public CI artifacts (PR #248, CI run
// 26207506594, artifact 7128234088). MUST trigger ≥1 ESLint error per
// the `NO_DIRECT_SCREENSHOT_RULE` selector in eslint.config.mjs.

/** Structural stand-in for a browser page handle; no browser dependency. */
interface IPageLike {
  screenshot(options: object): Promise<unknown>;
}

/**
 * Forbidden shape — direct `page.screenshot()` on a Page identifier.
 * @param page - Page-like handle.
 * @returns True after attempting capture.
 */
export async function violation(page: IPageLike): Promise<boolean> {
  // 🚫 NO_DIRECT_SCREENSHOT: direct screenshot
  await page.screenshot({ path: '/tmp/fake.png', fullPage: true });
  return true;
}

/**
 * Forbidden shape — `this.page.screenshot()` (the exact pre-fix pattern
 * in a legacy scraper base class before this PR). MemberExpression on `this`.
 */
class ViolationOnThis {
  private readonly page!: IPageLike;

  /**
   * @returns True after attempting capture.
   */
  async capture(): Promise<boolean> {
    // 🚫 NO_DIRECT_SCREENSHOT: bypass via this.page chain
    await this.page.screenshot({ path: '/tmp/fake.png', fullPage: true });
    return true;
  }
}

/**
 * Forbidden shape — chained MemberExpression `ctx.browser.page.screenshot()`.
 * @param ctx - Context object exposing a nested page handle.
 * @returns True after attempting capture.
 */
export async function violationChained(ctx: { browser: { page: IPageLike } }): Promise<boolean> {
  // 🚫 NO_DIRECT_SCREENSHOT: bypass via chained MemberExpression
  await ctx.browser.page.screenshot({ path: '/tmp/fake.png', fullPage: true });
  return true;
}

export { ViolationOnThis };
