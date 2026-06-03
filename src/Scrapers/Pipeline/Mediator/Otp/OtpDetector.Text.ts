/**
 * OTP-DETECTOR Text + Input detection — body-text patterns and
 * OTP input-field probing across the page and all child frames.
 */

import { type Frame, type Page } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';
import { tryInContext } from '../Selector/SelectorResolver.js';
import { OTP_INPUT_CANDIDATES, OTP_TEXT_PATTERNS, PHONE_PATTERN } from './OtpDetectorConfig.js';

const LOG = getDebug(import.meta.url);

type TextCheckResult = 'otp' | 'clear' | 'unknown';

/**
 * Retrieve the visible body text from the page for OTP pattern matching.
 * @param page - The Playwright page to read body text from.
 * @returns The body text content, or empty string on failure.
 */
async function getBodyText(page: Page): Promise<string> {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    return typeof text === 'string' ? text : '';
  } catch (error: unknown) {
    LOG.debug(error, 'getBodyText failed (page context inaccessible)');
    return '';
  }
}

/**
 * Detect OTP presence by matching known text patterns in the page body.
 * @param page - The Playwright page to check.
 * @returns The detection result: 'otp', 'clear', or 'unknown'.
 */
async function detectByText(page: Page): Promise<TextCheckResult> {
  const bodyText = await getBodyText(page);
  if (bodyText === '') return 'unknown';
  return OTP_TEXT_PATTERNS.some(pattern => bodyText.includes(pattern)) ? 'otp' : 'clear';
}

/**
 * Check a single frame for OTP input candidates.
 * @param frame - The frame to search within.
 * @returns True if an OTP input was found in the frame.
 */
async function checkFrameForOtpInput(frame: Frame): Promise<boolean> {
  const found = await tryInContext(frame, OTP_INPUT_CANDIDATES);
  return !!found;
}

/**
 * Detect OTP presence by searching for known OTP input fields on the
 * page and in frames.
 * @param page - The Playwright page to search.
 * @param cachedFrames - Optional pre-filtered list of child frames.
 * @returns True if an OTP input field was found.
 */
async function detectByInputField(page: Page, cachedFrames?: Frame[]): Promise<boolean> {
  const found = await tryInContext(page, OTP_INPUT_CANDIDATES);
  if (found) return true;
  const mainFrame = page.mainFrame();
  const frames = cachedFrames ?? page.frames().filter(f => f !== mainFrame);
  const frameTasks = frames.map(checkFrameForOtpInput);
  const results = await Promise.all(frameTasks);
  return results.some(Boolean);
}

/**
 * Probe the page DOM for an OTP input field and log the outcome.
 * @param page - Playwright page to probe.
 * @returns True iff an OTP input field was found.
 */
async function probeInputFieldAndLog(page: Page): Promise<boolean> {
  const isByInput = await detectByInputField(page);
  if (isByInput) LOG.debug('OTP detected by input field');
  return isByInput;
}

/**
 * Log diagnostic for the 'unknown' text-result branch.
 * Extracted so the caller can stay a single-line conditional.
 * @returns Sentinel `true` so the function has a meaningful return value.
 */
function logTextUnknown(): true {
  LOG.debug('Page text inaccessible — falling back to input-field probe');
  return true;
}

/**
 * Detect whether the current page is showing an OTP screen.
 * @param page - The Playwright page to check for OTP indicators.
 * @returns True if an OTP screen is detected.
 */
async function detectOtpScreen(page: Page): Promise<boolean> {
  const textResult = await detectByText(page);
  if (textResult === 'otp') {
    LOG.debug('OTP detected by text pattern');
    return true;
  }
  if (textResult === 'unknown') logTextUnknown();
  return probeInputFieldAndLog(page);
}

/**
 * Extract the masked phone number hint from the OTP screen body text.
 * @param page - The Playwright page to search for the phone hint.
 * @returns The matched phone hint string, or empty string if not found.
 */
async function extractPhoneHint(page: Page): Promise<string> {
  const bodyText = await getBodyText(page);
  const matched = PHONE_PATTERN.exec(bodyText);
  return matched?.[0] ?? '';
}

export { detectOtpScreen, extractPhoneHint };
