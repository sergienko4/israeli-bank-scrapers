/**
 * Layer 2 — WellKnown error-text probe for form errors.
 *
 * <p>Phase 12d split: extracted from {@link ../FormErrorDiscovery.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import { WK_LOGIN_ERROR } from '../../../Registry/WK/LoginWK.js';
import { isElementGoneError } from './ErrorDiscoveryDetached.js';
import { type IFormError, type IFormErrorScanResult, NO_ERRORS } from './ErrorDiscoveryTypes.js';

export { type IFormErrorScanResult } from './ErrorDiscoveryTypes.js';

/**
 * Narrow benign Playwright rejections to `false`; re-throw real bugs.
 * Extracted so {@link isFirstByTextVisible} stays at depth-1 (max-depth
 * rule, coding-principle §9).
 * @param err - Rejection caught by the visibility probe.
 * @returns `false` for benign element-gone signals; throws otherwise.
 */
function handleVisibilityError(err: unknown): boolean {
  if (isElementGoneError(err)) return false;
  throw err;
}

/**
 * `getByText().first().isVisible()` with a NARROW catch: detached /
 * destroyed frames return `false`; any other rejection re-throws so
 * real bugs surface (CR PR #345 finding #183, coding-principle §9).
 * @param frameOrPage - Page or frame where the form was submitted.
 * @param value - The error text to look for.
 * @returns True iff the text is visible RIGHT NOW; false when not
 *   present OR when the frame is gone.
 */
async function isFirstByTextVisible(frameOrPage: Page | Frame, value: string): Promise<boolean> {
  try {
    return await frameOrPage.getByText(value).first().isVisible();
  } catch (error) {
    return handleVisibilityError(error);
  }
}

/**
 * Check one WellKnown error text for visibility in a frame.
 * @param frameOrPage - Page or frame where the form was submitted.
 * @param value - The error text to look for.
 * @returns IFormErrorScanResult with hasErrors=true if the text is visible.
 */
async function probeWellKnownText(
  frameOrPage: Page | Frame,
  value: string,
): Promise<IFormErrorScanResult> {
  if (!(await isFirstByTextVisible(frameOrPage, value))) return NO_ERRORS;
  const error: IFormError = { selector: 'wellKnown', text: value, kind: 'authError' };
  return { hasErrors: true, errors: [error], summary: value };
}

/**
 * Reduce one WellKnown candidate onto the accumulator: keep the
 * accumulated hit when already found, otherwise probe this candidate.
 * Extracted from {@link checkFrameForErrors} for cap drain.
 * @param frameOrPage - Page or frame to probe.
 * @param prev - Accumulator from the previous step.
 * @param candidate - Current WellKnown candidate.
 * @param candidate.value - The error text to probe for.
 * @returns Aggregate scan result.
 */
async function reduceWkProbe(
  frameOrPage: Page | Frame,
  prev: Promise<IFormErrorScanResult>,
  candidate: { readonly value: string },
): Promise<IFormErrorScanResult> {
  const result = await prev;
  if (result.hasErrors) return result;
  return probeWellKnownText(frameOrPage, candidate.value);
}

/**
 * Layer 2: Search frame for WK error indicator texts.
 * Fallback for banks that don't use standard error markup
 * (mat-error, aria-invalid, etc.).
 * @param frameOrPage - Page or frame where the login form was submitted.
 * @returns IFormErrorScanResult with first visible error text, or hasErrors=false.
 */
export async function checkFrameForErrors(
  frameOrPage: Page | Frame,
): Promise<IFormErrorScanResult> {
  const seed: Promise<IFormErrorScanResult> = Promise.resolve(NO_ERRORS);
  return WK_LOGIN_ERROR.reduce(
    (prev, candidate): Promise<IFormErrorScanResult> => reduceWkProbe(frameOrPage, prev, candidate),
    seed,
  );
}
