/**
 * HeuristicResolver — Round 3 fallback for bare-iframe login fields.
 * When WK text/label/placeholder/name all fail, detects inputs by type:
 *   password → input[type="password"]
 *   id       → first visible non-password, non-hidden input
 *   num      → second visible non-password, non-hidden input
 *
 * Cross-validates: isVisible() + isEnabled() before claiming success.
 * Only fires when Round 1 (iframe) and Round 2 (main page) both return empty.
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { heuristicResolveInFrame, toHeuristicContext } from './HeuristicResolver.context.js';
import { isPage } from './SelectorResolver.js';
import type { IFieldContext } from './SelectorResolverPipeline.js';

const LOG = getDebug(import.meta.url);

/**
 * Probe frames recursively — first match wins.
 * @param frames - Child frames to search.
 * @param fieldKey - Credential key.
 * @param index - Current frame index.
 * @returns IFieldContext if found, or false.
 */
async function probeFrameAt(
  frames: readonly Frame[],
  fieldKey: string,
  index: number,
): Promise<IFieldContext | false> {
  if (index >= frames.length) return false;
  const match = await heuristicResolveInFrame(frames[index], fieldKey);
  if (match.selector) return toHeuristicContext(match, fieldKey);
  return probeFrameAt(frames, fieldKey, index + 1);
}

/**
 * Search all child iframes using heuristic type-based resolution.
 * @param page - The Playwright page.
 * @param fieldKey - The credential key to resolve.
 * @returns IFieldContext if found, or false if no frame had a match.
 */
async function heuristicProbeIframes(page: Page, fieldKey: string): Promise<IFieldContext | false> {
  const mainFrame = page.mainFrame();
  const childFrames = page.frames().filter(f => f !== mainFrame);
  if (childFrames.length === 0) return false;
  const count = String(childFrames.length);
  const masked = maskVisibleText(fieldKey);
  LOG.debug({ message: `Round 3: searching ${count} iframe(s) for "${masked}"` });
  return probeFrameAt(childFrames, fieldKey, 0);
}

/**
 * Probe iframes first, then fall back to main frame.
 * @param page - The Playwright page.
 * @param fieldKey - The credential key to resolve.
 * @returns IFieldContext if found, or false.
 */
async function probePageHeuristic(page: Page, fieldKey: string): Promise<IFieldContext | false> {
  const iframeResult = await heuristicProbeIframes(page, fieldKey);
  if (iframeResult) return iframeResult;
  const masked = maskVisibleText(fieldKey);
  LOG.debug({ message: `Round 3 (heuristic): trying main page for "${masked}"` });
  const mainFrame = page.mainFrame();
  const mainMatch = await heuristicResolveInFrame(mainFrame, fieldKey);
  if (mainMatch.selector) return toHeuristicContext(mainMatch, fieldKey);
  return false;
}

/**
 * Try heuristic resolution — entry point called by PipelineFieldResolver.
 * When pageOrFrame is a Page: searches all child iframes.
 * When pageOrFrame is a Frame (scoped): probes THAT frame directly (sticky frame).
 * @param pageOrFrame - The Playwright page or frame.
 * @param fieldKey - The credential key to resolve.
 * @returns IFieldContext if found, or false if heuristic failed.
 */
async function tryHeuristicProbe(
  pageOrFrame: Page | Frame,
  fieldKey: string,
): Promise<IFieldContext | false> {
  if (isPage(pageOrFrame)) return probePageHeuristic(pageOrFrame, fieldKey);
  const match = await heuristicResolveInFrame(pageOrFrame, fieldKey);
  if (!match.selector) return false;
  return toHeuristicContext(match, fieldKey);
}

export default tryHeuristicProbe;
export { heuristicResolveInFrame, tryHeuristicProbe };
