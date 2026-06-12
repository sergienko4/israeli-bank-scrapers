/**
 * Cookies cluster — get/add wrappers over the Playwright browser
 * context. `getCookies` projects only the three fields the audit
 * pipeline cares about; `addCookies` is a thin pass-through used for
 * cross-domain session promotion.
 */

import type { Page } from 'playwright-core';

import { type ICookieSnapshot, type IElementMediator } from '../ElementMediator.js';

/**
 * Build getCookies — extract cookies from browser context.
 *
 * <p><strong>Type-asymmetry note:</strong> the returned `ICookieSnapshot`
 * shape is intentionally a 3-field projection (name/domain/value) — it is
 * NOT round-trip compatible with {@link buildAddCookies}'s
 * `ICookieInjection` input, which requires the full Playwright cookie
 * shape (path, secure, httpOnly, sameSite, expires, …). Snapshots are for
 * audit/observability only; cross-domain session promotion must build a
 * fresh `ICookieInjection[]` carrying the security-relevant fields.
 *
 * @param page - The Playwright page.
 * @returns Async function returning cookie array.
 */
function buildGetCookies(page: Page): () => Promise<readonly ICookieSnapshot[]> {
  return async (): Promise<readonly ICookieSnapshot[]> => {
    const raw = await page.context().cookies();
    return raw.map((c): ICookieSnapshot => ({ name: c.name, domain: c.domain, value: c.value }));
  };
}

/**
 * Build addCookies — inject cookies into the browser context for
 * cross-domain session promotion. Extracted from the historic inline
 * arrow inside `createElementMediator` so the factory body stays ≤10 LoC.
 *
 * <p><strong>Type-asymmetry note:</strong> accepts `ICookieInjection` (the
 * full Playwright cookie shape) — NOT the 3-field `ICookieSnapshot`
 * produced by {@link buildGetCookies}. To round-trip a snapshot back into
 * the context, callers must reconstruct the missing security fields
 * (path, secure, httpOnly, sameSite, expires) explicitly.
 *
 * @param page - The Playwright page (provides the context).
 * @returns Async function that accepts a cookie array.
 */
function buildAddCookies(page: Page): IElementMediator['addCookies'] {
  return async (cookies): Promise<void> => {
    await page.context().addCookies(cookies);
  };
}

/** Cookie I/O — get + add against the browser context. */
export type CookieBundle = Pick<IElementMediator, 'getCookies' | 'addCookies'>;

/**
 * Build the 2-method cookie I/O cluster.
 * @param page - The Playwright page (provides the browser context).
 * @returns Cookie I/O method bundle.
 */
export function buildCookieCluster(page: Page): CookieBundle {
  return {
    getCookies: buildGetCookies(page),
    addCookies: buildAddCookies(page),
  };
}
