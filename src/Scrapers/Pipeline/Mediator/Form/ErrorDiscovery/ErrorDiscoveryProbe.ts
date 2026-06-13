/**
 * Layer 2 — WellKnown error-text probe for form errors.
 *
 * <p>Phase 12d split: extracted from {@link ../FormErrorDiscovery.ts}.
 */

import type { Frame, Page } from 'playwright-core';

import { WK_LOGIN_ERROR } from '../../../Registry/WK/LoginWK.js';
import { type IFormError, type IFormErrorScanResult, NO_ERRORS } from './ErrorDiscoveryTypes.js';

export { type IFormErrorScanResult } from './ErrorDiscoveryTypes.js';

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
  const locator = frameOrPage.getByText(value);
  const first = locator.first();
  /**
   * Element not visible or detached.
   * @returns False.
   */
  const catchFalse = (): boolean => false;
  const isErrorVisible = await first.isVisible().catch(catchFalse);
  if (!isErrorVisible) return NO_ERRORS;
  const error: IFormError = { selector: 'wellKnown', text: value, kind: 'authError' };
  const result: IFormErrorScanResult = { hasErrors: true, errors: [error], summary: value };
  return result;
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
  const candidates = WK_LOGIN_ERROR;
  const initial: Promise<IFormErrorScanResult> = Promise.resolve(NO_ERRORS);
  type TReduce = Promise<IFormErrorScanResult>;
  return candidates.reduce<TReduce>(async (prev, candidate): TReduce => {
    const result = await prev;
    if (result.hasErrors) return result;
    return probeWellKnownText(frameOrPage, candidate.value);
  }, initial);
}
