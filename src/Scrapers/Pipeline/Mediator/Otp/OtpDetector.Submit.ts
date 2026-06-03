/**
 * OTP-DETECTOR Submit — finds the OTP submit-button selector across
 * the main page and all child frames.
 */

import { type Page } from 'playwright-core';

import { tryInContext } from '../Selector/SelectorResolver.js';
import { OTP_SUBMIT_CANDIDATES } from './OtpDetectorConfig.js';

/**
 * Find the Playwright selector for the OTP submit button across all frames.
 * @param page - The Playwright page to search for submit buttons.
 * @returns The matched selector (CSS or XPath), or empty string if not found.
 */
async function findOtpSubmitSelector(page: Page): Promise<string> {
  const main = await tryInContext(page, OTP_SUBMIT_CANDIDATES);
  if (main) return main;
  const mainFrame = page.mainFrame();
  const nonMainFrames = page.frames().filter(f => f !== mainFrame);
  const frameTasks = nonMainFrames.map(frame => tryInContext(frame, OTP_SUBMIT_CANDIDATES));
  const results = await Promise.all(frameTasks);
  return results.find(sel => sel.length > 0) ?? '';
}

export default findOtpSubmitSelector;
