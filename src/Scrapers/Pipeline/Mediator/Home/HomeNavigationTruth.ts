/**
 * HOME navigation truth — did the browser actually leave the homepage?
 *
 * <p>HOME's POST gate treats a URL change as proof that `action(navigate)`
 * succeeded. Comparing the raw strings makes that proof worthless: bank configs
 * carry a bare origin (`https://www.max.co.il`) while the browser always reports
 * the normalized form (`https://www.max.co.il/`), so the comparison yielded
 * `true` for every bank on every run. HOME could not fail, so the pipeline's
 * sanitization pulse — the recovery that re-runs interceptors to clear a
 * late-appearing overlay and retries the phase — could never engage.
 */

import type { Brand } from '../../Types/Brand.js';

/** True when the browser has left the configured homepage. */
type DidNavigate = Brand<boolean, 'DidNavigate'>;

/** Path separator, and the value a fully-trimmed path collapses to. */
const SLASH = '/';

/**
 * Collapse a trailing slash so `''`, `'/'` and `'/he/'` compare equal to their
 * unslashed forms.
 *
 * <p>Scans instead of using `/\/+$/` — that pattern backtracks super-linearly
 * on a long run of slashes (typescript:S8786), and the URL here is attacker-
 * influenced via redirects.
 *
 * @param pathname - URL pathname component.
 * @returns Pathname without a trailing slash, or `'/'` when empty.
 */
function normalizePath(pathname: string): string {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === SLASH) {
    end -= 1;
  }
  return end === 0 ? SLASH : pathname.slice(0, end);
}

/**
 * Reduce a URL to the key that identifies "which page".
 *
 * <p>Deliberately conservative: only the trailing slash and the fragment are
 * normalized away. The query string stays significant, so a bank that navigates
 * by changing only a query parameter is still counted as having navigated. That
 * keeps this change to the exact artifact it targets and cannot reclassify any
 * bank's real navigation as standing still.
 *
 * @param url - Absolute URL string.
 * @returns Comparison key, or false when the URL cannot be parsed.
 */
function toPageKey(url: string): string | false {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return parsed.origin + normalizePath(parsed.pathname) + parsed.search;
}

/**
 * Decide whether the browser has left the configured homepage.
 * Falls back to strict inequality when either side is unparseable — a malformed
 * config value must never throw inside a phase gate.
 * @param currentUrl - URL the browser is on now.
 * @param homepageUrl - Configured bank homepage (`config.urls.base`).
 * @returns True iff the current page differs from the homepage.
 */
function hasLeftHomepage(currentUrl: string, homepageUrl: string): DidNavigate {
  const current = toPageKey(currentUrl);
  const homepage = toPageKey(homepageUrl);
  if (current === false || homepage === false) {
    return (currentUrl !== homepageUrl) as DidNavigate;
  }
  return (current !== homepage) as DidNavigate;
}

export type { DidNavigate };
export { hasLeftHomepage };
