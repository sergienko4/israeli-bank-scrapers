/**
 * Harvester wait helpers.
 *
 * <p>Generic wait primitives the harvester uses between navigate-reveal
 * and snapshot to handle SPA hydration. Carried in a separate module
 * so unit tests can exercise the behaviour against a mock {@link Page}
 * without booting Chromium.
 *
 * <p>`waitForCredentialInputIfNeeded` covers SPA banks where the
 * credential form is injected post-hydration (VisaCal is the
 * motivating case — Angular shell snapshotted before bootstrap). The
 * structural selector `input[type="password"]` is explicitly
 * whitelisted per CLAUDE.md "Structural CSS selectors allowed in
 * parsing/extraction code (frame detection via input[type=password])".
 */

import type { Page } from 'playwright-core';

/** Default wait — long enough for SPA bootstrap on slow CI runners. */
const DEFAULT_CREDENTIAL_WAIT_TIMEOUT_MS = 30000;

/** Canonical credential-input structural marker (whitelisted in CLAUDE.md). */
const CREDENTIAL_INPUT_SELECTOR = 'input[type="password"]';

/**
 * Wait for a credential `<input type="password">` to appear when the
 * recipe flag is set. No-op when `enabled` is falsy.
 *
 * @param page - Playwright page to wait on.
 * @param enabled - Recipe `waitForCredentialInput` flag.
 * @param timeoutMs - Wait timeout (defaults to 30000 ms).
 * @returns True when a wait was performed, false when skipped.
 */
async function waitForCredentialInputIfNeeded(
  page: Page,
  enabled?: boolean,
  timeoutMs: number = DEFAULT_CREDENTIAL_WAIT_TIMEOUT_MS,
): Promise<boolean> {
  if (enabled !== true) return false;
  await page.waitForSelector(CREDENTIAL_INPUT_SELECTOR, { timeout: timeoutMs });
  return true;
}

export {
  CREDENTIAL_INPUT_SELECTOR,
  DEFAULT_CREDENTIAL_WAIT_TIMEOUT_MS,
  waitForCredentialInputIfNeeded,
};
