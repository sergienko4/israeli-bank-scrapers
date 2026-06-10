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
 * helper scans BOTH the top-level frame AND every nested iframe — many
 * Israeli bank login screens host the password input inside a
 * cross-origin auth iframe. The structural selector
 * `input[type="password"]` is explicitly whitelisted per CLAUDE.md
 * "Structural CSS selectors allowed in parsing/extraction code
 * (frame detection via input[type=password])".
 */

import type { Frame, Page } from 'playwright-core';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';

/** Default wait — long enough for SPA bootstrap on slow CI runners. */
const DEFAULT_CREDENTIAL_WAIT_TIMEOUT_MS = 30000;

/** Poll interval while scanning frames for the credential input. */
const FRAME_POLL_INTERVAL_MS = 250;

/** Canonical credential-input structural marker (whitelisted in CLAUDE.md). */
const CREDENTIAL_INPUT_SELECTOR = 'input[type="password"]';

/**
 * Check whether the given frame already exposes a credential input.
 * @param frame - Playwright frame to probe.
 * @returns True when `input[type="password"]` is present in the frame.
 */
async function frameHasCredential(frame: Frame): Promise<boolean> {
  const handle = await frame.$(CREDENTIAL_INPUT_SELECTOR);
  return handle !== null;
}

/**
 * Walk a frame slice and return true if any frame has the credential.
 * Recursive form satisfies the project's no-await-in-loop rule.
 *
 * @param frames - Remaining frames to probe.
 * @param idx - Current frame index.
 * @returns True when one frame has the credential input.
 */
async function anyHasCredAtIdx(frames: readonly Frame[], idx: number): Promise<boolean> {
  if (idx >= frames.length) return false;
  const frame = frames[idx];
  if (await frameHasCredential(frame)) return true;
  return anyHasCredAtIdx(frames, idx + 1);
}

/**
 * Check whether ANY frame in the page exposes a credential input.
 * @param page - Playwright page whose frames are scanned.
 * @returns True when at least one frame has the credential input.
 */
async function anyFrameHasCredential(page: Page): Promise<boolean> {
  const frames = page.frames();
  return anyHasCredAtIdx(frames, 0);
}

/** Bundled args for the recursive credential-wait poll. */
interface ICredentialPollArgs {
  readonly page: Page;
  readonly deadline: number;
  readonly originalTimeoutMs: number;
}

/**
 * Recursive poll driver — replaces a while+await loop to satisfy
 * `no-await-in-loop`. Re-enters itself after each idle delay.
 * @param args - Bundled credential-poll args (page + deadline + budget).
 * @returns True on success.
 * @throws ScraperError when the deadline elapses without a hit.
 */
async function pollCredential(args: ICredentialPollArgs): Promise<boolean> {
  if (Date.now() >= args.deadline) throw credentialTimeoutError(args.originalTimeoutMs);
  const wasFound = await anyFrameHasCredential(args.page);
  if (wasFound) return true;
  await args.page.waitForTimeout(FRAME_POLL_INTERVAL_MS);
  return pollCredential(args);
}

/**
 * Build the deterministic timeout error message preserved for log
 * triage compatibility with the historic Playwright wording.
 * @param timeoutMs - Total wait budget that just elapsed.
 * @returns ScraperError ready to throw.
 */
function credentialTimeoutError(timeoutMs: number): ScraperError {
  return new ScraperError(
    `Timeout ${String(timeoutMs)}ms exceeded waiting for ${CREDENTIAL_INPUT_SELECTOR} in any frame`,
  );
}

/**
 * Build the bundled credential-poll args.
 * Extracted to keep {@link waitForCredentialInputIfNeeded} under the
 * 10-line cap.
 * @param page - Playwright page.
 * @param timeoutMs - Wait budget in milliseconds.
 * @returns Frozen credential-poll args.
 */
function buildCredentialPollArgs(page: Page, timeoutMs: number): ICredentialPollArgs {
  return { page, deadline: Date.now() + timeoutMs, originalTimeoutMs: timeoutMs };
}

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
  const args = buildCredentialPollArgs(page, timeoutMs);
  await pollCredential(args);
  return true;
}

export {
  CREDENTIAL_INPUT_SELECTOR,
  DEFAULT_CREDENTIAL_WAIT_TIMEOUT_MS,
  FRAME_POLL_INTERVAL_MS,
  waitForCredentialInputIfNeeded,
};
