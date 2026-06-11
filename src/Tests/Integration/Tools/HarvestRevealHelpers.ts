/**
 * Harvester reveal helpers.
 *
 * <p>Frame-aware visible-text click. The legacy harvester used
 * {@link Page.getByText} which only sees the top-level frame; modern
 * Israeli bank login UIs commonly host the credential UI inside
 * cross-origin iframes (VisaCal's connect.cal-online.co.il auth
 * iframe is the motivating case, AMEX cross-origin auth pages
 * follow the same pattern).
 *
 * <p>{@link clickRevealAnyFrame} scans the whole frame tree on each
 * poll and clicks the first matching visible-text element. The
 * frame-by-frame iteration uses Playwright's per-frame
 * {@link Frame.getByText} which honours cross-origin iframes via
 * CDP, so the call works without any cross-origin XHR.
 *
 * <p>Per CLAUDE.md, this helper is "extraction/parsing" code (the
 * recipe layer, not user-facing interaction code) — visible-text
 * anchors only, no CSS selectors.
 */

import type { Frame, Page } from 'playwright-core';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';

/** Default total wait while polling frames for the reveal target. */
const DEFAULT_REVEAL_TIMEOUT_MS = 45000;

/** Poll interval while scanning frames for the reveal element. */
const REVEAL_POLL_INTERVAL_MS = 250;

/** Per-frame click timeout — cheap, since we just confirmed `count > 0`. */
const REVEAL_FRAME_CLICK_TIMEOUT_MS = 5000;

/**
 * Click `text` inside a single frame using a tight per-click timeout.
 * Extracted to keep {@link tryClickInFrame} under the 10-line cap.
 * @param frame - Playwright frame.
 * @param text - Visible text to match.
 * @returns True after the click succeeded.
 */
async function clickRevealInFrame(frame: Frame, text: string): Promise<true> {
  const target = frame.getByText(text, { exact: false }).first();
  await target.click({ timeout: REVEAL_FRAME_CLICK_TIMEOUT_MS });
  return true;
}

/**
 * Try to click `text` inside a single frame.
 * Swallows errors so the caller can keep iterating remaining frames.
 *
 * @param frame - Playwright frame to probe.
 * @param text - Visible text to match (substring, case-sensitive).
 * @returns True when the click succeeded, false otherwise.
 */
async function tryClickInFrame(frame: Frame, text: string): Promise<boolean> {
  try {
    const target = frame.getByText(text, { exact: false }).first();
    const found = await target.count();
    if (found === 0) return false;
    return await clickRevealInFrame(frame, text);
  } catch {
    return false;
  }
}

/**
 * Walk a frame slice and return true when one click succeeds.
 * Recursive form satisfies the project's no-await-in-loop rule.
 *
 * @param frames - Remaining frames to probe.
 * @param text - Visible text to match.
 * @param idx - Current frame index.
 * @returns True when one frame was clicked, false otherwise.
 */
async function clickAtFrameIdx(
  frames: readonly Frame[],
  text: string,
  idx: number,
): Promise<boolean> {
  if (idx >= frames.length) return false;
  const frame = frames[idx];
  if (await tryClickInFrame(frame, text)) return true;
  return clickAtFrameIdx(frames, text, idx + 1);
}

/**
 * Single pass over all frames trying to click the reveal text.
 * @param page - Playwright page whose frames are scanned.
 * @param text - Visible text to match.
 * @returns True when one frame was clicked, false otherwise.
 */
async function tryClickRevealAnyFrameOnce(page: Page, text: string): Promise<boolean> {
  const frames = page.frames();
  return clickAtFrameIdx(frames, text, 0);
}

/** Bundled args for the recursive click-reveal poll. */
interface IRevealPollArgs {
  readonly page: Page;
  readonly text: string;
  readonly deadline: number;
}

/**
 * Recursive poll driver — replaces a while+await loop to satisfy
 * `no-await-in-loop`. Re-enters itself after each idle delay.
 * @param args - Bundled reveal-poll args (page + text + deadline).
 * @returns True on success.
 * @throws ScraperError when the deadline elapses without a hit.
 */
async function pollClickReveal(args: IRevealPollArgs): Promise<boolean> {
  if (Date.now() >= args.deadline) throw revealTimeoutError(args);
  const wasClicked = await tryClickRevealAnyFrameOnce(args.page, args.text);
  if (wasClicked) return true;
  await args.page.waitForTimeout(REVEAL_POLL_INTERVAL_MS);
  return pollClickReveal(args);
}

/**
 * Build the deterministic timeout error for log triage.
 * @param args - Bundled reveal-poll args (deadline + text + budget).
 * @returns ScraperError ready to throw.
 */
function revealTimeoutError(args: IRevealPollArgs): ScraperError {
  return new ScraperError(
    `Timeout exceeded waiting for visible text "${args.text}" in any frame (deadline ${String(args.deadline)})`,
  );
}

/**
 * Click a visible-text element anywhere in the page's frame tree.
 * Polls every {@link REVEAL_POLL_INTERVAL_MS} ms until the deadline
 * elapses.
 *
 * @param page - Playwright page to scan.
 * @param text - Visible text to find and click.
 * @param timeoutMs - Total wait budget (milliseconds).
 * @returns True when the click succeeded.
 */
async function clickRevealAnyFrame(
  page: Page,
  text: string,
  timeoutMs: number = DEFAULT_REVEAL_TIMEOUT_MS,
): Promise<boolean> {
  return pollClickReveal({ page, text, deadline: Date.now() + timeoutMs });
}

export {
  clickRevealAnyFrame,
  DEFAULT_REVEAL_TIMEOUT_MS,
  REVEAL_FRAME_CLICK_TIMEOUT_MS,
  REVEAL_POLL_INTERVAL_MS,
};
