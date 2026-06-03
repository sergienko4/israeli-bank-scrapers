/**
 * LOGIN frame-scan helpers — main-page + all-iframes error scanning
 * with a per-frame budget cap.
 *
 * <p>Phase 2d strict-cluster split: extracted from
 * {@link ./LoginPhaseActions.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import type { IElementMediator } from '../Elements/ElementMediator.js';
import { LOGIN_PER_FRAME_SCAN_TIMEOUT_MS } from '../Timing/TimingConfig.js';

/** Minimal error-scan result shape for the all-frames helper. */
interface IFramesScanResult {
  readonly hasErrors: boolean;
  readonly summary: string;
}

/** Empty scan sentinel for the all-frames helper. */
const FRAMES_NO_ERRORS: IFramesScanResult = { hasErrors: false, summary: '' };

/**
 * Produce a Promise that resolves to FRAMES_NO_ERRORS after ms elapses.
 * @param ms - Budget in milliseconds.
 * @returns Empty-scan Promise.
 */
async function budgetFrameScan(ms: number): Promise<IFramesScanResult> {
  const { setTimeout: setTimeoutPromise } = await import('node:timers/promises');
  await setTimeoutPromise(ms, undefined, { ref: false });
  return FRAMES_NO_ERRORS;
}

/**
 * Scan a single frame, swallowing detached-frame errors AND capping the
 * call at PER_FRAME_SCAN_TIMEOUT_MS so one hung frame cannot stall the
 * Promise.all fan-out.
 * @param mediator - Element mediator.
 * @param frame - Page or iframe to scan.
 * @returns Scan result (empty on failure or timeout).
 */
async function safeScanFrame(
  mediator: IElementMediator,
  frame: Page | Frame,
): Promise<IFramesScanResult> {
  const discover = mediator.discoverErrors(frame).catch((): IFramesScanResult => FRAMES_NO_ERRORS);
  const budget = budgetFrameScan(LOGIN_PER_FRAME_SCAN_TIMEOUT_MS);
  const scan = await Promise.race([discover, budget]);
  if (!scan.hasErrors) return FRAMES_NO_ERRORS;
  return { hasErrors: true, summary: scan.summary };
}

/**
 * Build the per-frame scan promise list — extracted so the caller
 * stays inside the 10-LoC ceiling.
 * @param mediator - Element mediator passed to safeScanFrame.
 * @param frames - Page + child iframes in scan order.
 * @returns Array of per-frame scan promises.
 */
function scanFramesAll(
  mediator: IElementMediator,
  frames: readonly (Page | Frame)[],
): readonly Promise<IFramesScanResult>[] {
  return frames.map((frame): Promise<IFramesScanResult> => safeScanFrame(mediator, frame));
}

/**
 * Scan the main page AND every child iframe for error markers in
 * parallel. Returns the first frame's error scan that has errors.
 * @param mediator - Element mediator (exposes discoverErrors).
 * @param page - Playwright page.
 * @returns Scan result — first frame with errors wins.
 */
async function discoverErrorsAllFrames(
  mediator: IElementMediator,
  page: Page,
): Promise<IFramesScanResult> {
  const frames: readonly (Page | Frame)[] = [page, ...page.frames()];
  const scanPromises = scanFramesAll(mediator, frames);
  const scans = await Promise.all(scanPromises);
  const hit = scans.find((scan): boolean => scan.hasErrors);
  return hit ?? FRAMES_NO_ERRORS;
}

export type { IFramesScanResult };
export { discoverErrorsAllFrames, FRAMES_NO_ERRORS, safeScanFrame };
