// Canary: NO_DIRECT_SCREENSHOT — direct `page.screenshot()` calls bypass
// the SafeScreenshot helper which short-circuits in CI, causing rendered
// post-auth bank pixels to leak into public CI artifacts (PR #248, CI run
// 26207506594, artifact 7128234088). MUST trigger ≥1 ESLint error per
// the `NO_DIRECT_SCREENSHOT_RULE` selector in eslint.config.mjs.

import type { Page } from 'playwright-core';

/**
 * Forbidden shape — direct `page.screenshot()` on a Page identifier.
 * @param page - Playwright Page handle.
 * @returns True after attempting capture.
 */
export async function violation(page: Page): Promise<boolean> {
  // 🚫 NO_DIRECT_SCREENSHOT: bypass of safeScreenshot()
  await page.screenshot({ path: '/tmp/fake.png', fullPage: true });
  return true;
}

/**
 * Forbidden shape — `this.page.screenshot()` (the exact pre-fix pattern
 * in BaseScraperWithBrowser before this PR). MemberExpression on `this`.
 */
class ViolationOnThis {
  private readonly page!: Page;

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
export async function violationChained(ctx: { browser: { page: Page } }): Promise<boolean> {
  // 🚫 NO_DIRECT_SCREENSHOT: bypass via chained MemberExpression
  await ctx.browser.page.screenshot({ path: '/tmp/fake.png', fullPage: true });
  return true;
}

export { ViolationOnThis };
