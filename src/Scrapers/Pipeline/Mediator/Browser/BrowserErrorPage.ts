/**
 * Firefox / Camoufox neterror-page detection.
 *
 * <p>Camoufox runs on Firefox; when DNS resolution fails, TCP connect
 * times out, or TLS handshake fails, Firefox renders a built-in error
 * page (local `about:neterror` content displayed at the target URL).
 * The page returns from `page.goto` and from any subsequent navigation
 * as if it succeeded — `commit` fires, DOM loads, `page.url()` reports
 * the target URL — but the content is Firefox's local error chrome,
 * not the bank's HTML.
 *
 * <p>Title-based detection is the cheapest reliable signal — Firefox
 * sets a deterministic title for every neterror sub-type. Patterns
 * observed in PR #221 review-fix session 2026-05-11 (multiple
 * pre-commit Phase 5 failures, screenshots captured):
 *
 * <ul>
 *   <li>`Server Not Found` — Firefox &lt; 100 DNS failure title.</li>
 *   <li>`Hmm. We're having trouble finding that site.` — Firefox 100+
 *       DNS failure title.</li>
 *   <li>`Unable to connect` — TCP refused / unreachable.</li>
 *   <li>`Connection timed out` / `Did Not Connect` — TLS / network
 *       timeout (additional variants for safety margin).</li>
 *   <li>`Problem loading page` — generic fallback.</li>
 * </ul>
 *
 * <p>Reused from INIT.POST + LOGIN.PRE so each post-navigation phase
 * fails loud immediately instead of cascading the error through
 * downstream phases.
 */

/** Closed list of neterror title fragments — extend at the bottom. */
const NETERROR_PATTERNS: readonly string[] = [
  'Server Not Found',
  'trouble finding that site',
  'Unable to connect',
  'Connection timed out',
  'Did Not Connect',
  'Problem loading page',
];

/** Compiled case-insensitive matcher built from {@link NETERROR_PATTERNS}. */
const FIREFOX_NETERROR_TITLE = new RegExp(NETERROR_PATTERNS.join('|'), 'i');

/** Minimal Page-like shape `probeFirefoxNeterror` consumes. */
export interface ITitledPage {
  readonly title: () => Promise<string>;
}

/** Outcome of the neterror probe — captured title + boolean verdict. */
export interface INeterrorProbeResult {
  readonly title: string;
  readonly isNeterror: boolean;
}

/**
 * Probe `page.title()` and report whether the page is Firefox's
 * neterror chrome. Both synchronous throws (e.g. `page.title` is not
 * a function on a partial stub) AND promise rejections (Playwright
 * `evaluate` failure on a detached page) are absorbed — the gate is
 * observability-only and must never crash the caller. Sync-throws
 * are caught via `Promise.resolve().then(...)` so they land inside
 * the Promise chain.
 *
 * @param page - Page-like object exposing `title(): Promise<string>`.
 * @returns Captured title + boolean flag. `isNeterror=false` when the
 *   title is empty (probe failed) so the check fails open by default.
 */
export default async function probeFirefoxNeterror(
  page: ITitledPage,
): Promise<INeterrorProbeResult> {
  const title = await Promise.resolve()
    .then((): Promise<string> => page.title())
    .catch((): string => '');
  if (title.length === 0) return { title, isNeterror: false };
  const isNeterror = FIREFOX_NETERROR_TITLE.test(title);
  return { title, isNeterror };
}
