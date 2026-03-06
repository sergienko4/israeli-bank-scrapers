import path from 'path';
import { type Frame, type Page } from 'playwright';

import type { OtpFillOpts } from '../Interfaces/Common/OtpFillOpts';
import { ScraperErrorTypes } from '../Scrapers/Base/Errors';
import { type ScraperOptions, type ScraperScrapingResult } from '../Scrapers/Base/Interface';
import { getDebug } from './Debug';
import { clickButton, fillInput } from './ElementsInteractions';
import {
  clickOtpTriggerIfPresent,
  detectOtpScreen,
  extractPhoneHint,
  OTP_SUBMIT_CANDIDATES,
} from './OtpDetector';
import waitForPageStability from './PageStability';
import { candidateToCss, resolveFieldContext, tryInContext } from './SelectorResolver';
import { sleep } from './Waiting';

const LOG = getDebug('otp-handler');

const OTP_ANIMATION_DELAY_MS = 800;

/**
 * Takes a full-page screenshot and saves it to the given directory with a timestamp filename.
 *
 * @param page - the Playwright Page to screenshot
 * @param screenshotDir - the directory path where the screenshot file should be saved
 * @returns the absolute file path of the saved screenshot
 */
async function saveScreenshot(page: Page, screenshotDir: string): Promise<string> {
  const nowMs = Date.now();
  const timestamp = String(nowMs);
  const screenshotPath = path.join(screenshotDir, `otp-required-${timestamp}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

/**
 * Builds the failure result returned when an OTP screen is detected but no retriever function
 * was provided. Optionally saves a diagnostic screenshot to screenshotDir.
 *
 * @param page - the Playwright Page showing the OTP screen, used for the screenshot
 * @param screenshotDir - optional directory to save a screenshot into for diagnostics
 * @returns a failure ScraperScrapingResult with errorType TwoFactorRetrieverMissing
 */
async function buildMissingRetrieverResult(
  page: Page,
  screenshotDir?: string,
): Promise<ScraperScrapingResult> {
  let errorMessage =
    'OTP screen detected but otpCodeRetriever is not set in options. ' +
    'Provide otpCodeRetriever to handle two-factor authentication.';
  if (screenshotDir) {
    try {
      const screenshotPath = await saveScreenshot(page, screenshotDir);
      errorMessage += ` Screenshot saved to ${screenshotPath}`;
    } catch (e: unknown) {
      LOG.info(e, 'screenshot failed');
    }
  }
  return { success: false, errorType: ScraperErrorTypes.TwoFactorRetrieverMissing, errorMessage };
}

const OTP_FILL_INPUT_SELECTORS = [
  '#codeinput',
  'input[placeholder*="סיסמה"]:not([id="password"])',
  'input[placeholder*="קוד חד פעמי"]',
  'input[placeholder*="קוד SMS"]',
  'input[placeholder*="קוד אימות"]',
  'input[placeholder*="הזן קוד"]',
  'input[placeholder*="one-time"]',
  'input[type="tel"]',
  '[name="otpCode"]',
];

/**
 * Checks whether the given frame contains any of the known OTP input selectors.
 *
 * @param frame - the Playwright Frame to search for an OTP input element
 * @returns the frame when an OTP input is found, or null otherwise
 */
async function frameHasOtpInput(frame: Frame): Promise<Frame | null> {
  const selectorChecks = OTP_FILL_INPUT_SELECTORS.map(sel => frame.$(sel).catch(() => null));
  const found = await Promise.all(selectorChecks);
  if (found.some(Boolean)) return frame;
  return null;
}

/**
 * Searches all frames on the page for one containing an OTP input field,
 * returning the first matching frame or null when none is found.
 *
 * @param page - the Playwright Page whose frames are searched
 * @returns the Frame containing an OTP input, or null if no frame has one
 */
async function findOtpFillFrame(page: Page): Promise<Frame | null> {
  const frameChecks = page.frames().map(frameHasOtpInput);
  const results = await Promise.all(frameChecks);
  const match = results.find(Boolean) ?? null;
  if (match) {
    const matchFrameUrl = match.url().slice(-60);
    LOG.info('OTP input found in frame %s', matchFrameUrl);
  }
  return match;
}

/**
 * Injects an OTP code directly into a form input element via page evaluation,
 * firing an input event so SPA frameworks recognise the value change.
 *
 * @param el - the Playwright ElementHandle for the OTP input element
 * @param code - the OTP code string to inject
 */
async function injectOtpViaEvaluate(
  el: Awaited<ReturnType<Frame['$']>>,
  code: string,
): Promise<void> {
  await el?.evaluate((input: HTMLInputElement, val: string) => {
    input.focus();
    input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, code);
}

/**
 * Types the OTP code into the input field via locator.pressSequentially, falling back to
 * direct DOM injection when the locator approach fails (e.g. hidden or detached elements).
 *
 * @param opts - options including the target frame, selector, element handle, and OTP code
 */
async function fillOtpWithFallback(opts: OtpFillOpts): Promise<void> {
  const { frame, sel, el, code } = opts;
  await sleep(OTP_ANIMATION_DELAY_MS);
  try {
    await frame.locator(sel).first().pressSequentially(code, { delay: 80 });
    LOG.info('typed OTP code via locator.type() selector: %s', sel);
  } catch (e: unknown) {
    LOG.info(e, 'locator.type() failed, falling back to evaluate injection');
    await injectOtpViaEvaluate(el, code);
  }
}

/**
 * Finds the first present OTP input selector in the frame and types the code into it.
 * Uses fillOtpWithFallback for compatibility with hidden or framework-managed inputs.
 *
 * @param frame - the Playwright Frame containing the OTP input field
 * @param code - the OTP code string to type
 */
async function typeOtpCode(frame: Frame, code: string): Promise<void> {
  const otpInputProbes = OTP_FILL_INPUT_SELECTORS.map(sel =>
    frame
      .$(sel)
      .catch(() => null)
      .then(el => ({ sel, el })),
  );
  const results = await Promise.all(otpInputProbes);
  const match = results.find(r => r.el);
  if (match) await fillOtpWithFallback({ frame, ...match, code });
}

/**
 * Clicks the OTP submit button via DOM evaluation, removing its disabled attribute first
 * and using jQuery trigger when available for SPA compatibility.
 *
 * @param match - an object containing the CSS selector and ElementHandle for the submit button
 * @param match.sel - the CSS selector string identifying the submit button
 * @param match.el - the Playwright ElementHandle for the submit button
 */
async function clickOtpButton(match: {
  sel: string;
  el: Awaited<ReturnType<Frame['$']>>;
}): Promise<void> {
  await match.el?.evaluate((btn: HTMLElement) => {
    btn.removeAttribute('disabled');
    const win = window as Window &
      typeof globalThis & { $?: (s: string) => { trigger: (e: string) => void } };
    if (win.$ && btn.id) win.$(`#${btn.id}`).trigger('click');
    else btn.click();
  });
  LOG.info('clicked OTP submit button via evaluate: %s', match.sel);
}

/**
 * Finds and clicks the OTP submit button within a specific frame using the OTP_SUBMIT_CANDIDATES list.
 * Logs a message and returns without error when no submit button is found.
 *
 * @param frame - the Playwright Frame to search for an OTP submit button
 */
async function submitOtpInFrame(frame: Frame): Promise<void> {
  const submitProbes = OTP_SUBMIT_CANDIDATES.map(candidate => {
    const sel = candidateToCss(candidate);
    return frame
      .$(sel)
      .catch(() => null)
      .then(el => ({ sel, el }));
  });
  const results = await Promise.all(submitProbes);
  const match = results.find(r => r.el);
  if (!match) {
    const submitFrameUrl = frame.url().slice(-60);
    LOG.info('no OTP submit button found in frame %s', submitFrameUrl);
    return;
  }
  await clickOtpButton(match);
}

/**
 * Enters the OTP code into the appropriate input and submits the OTP form.
 * Tries frame-based input first; falls back to resolveFieldContext for the main page.
 *
 * @param page - the Playwright Page showing the OTP entry screen
 * @param code - the OTP code string to enter and submit
 */
async function fillAndSubmitOtpCode(page: Page, code: string): Promise<void> {
  const frame = await findOtpFillFrame(page);
  if (frame) {
    const fillFrameUrl = frame.url().slice(-60);
    LOG.info('filling OTP in frame: %s', fillFrameUrl);
    await typeOtpCode(frame, code);
    await submitOtpInFrame(frame);
    return;
  }
  LOG.info('fillAndSubmitOtpCode: frame scan found nothing, falling back to resolveFieldContext');
  const currentPageUrl = page.url();
  const { selector: inputSelector, context } = await resolveFieldContext(
    page,
    { credentialKey: 'otpCode', selectors: [{ kind: 'name', value: 'otpCode' }] },
    currentPageUrl,
  );
  await fillInput(context, inputSelector, code);
  const submitSelector = await tryInContext(context, OTP_SUBMIT_CANDIDATES);
  if (submitSelector) await clickButton(context, submitSelector);
}

/**
 * Waits briefly after OTP submission and checks whether the OTP screen is still visible.
 * Returns an InvalidOtp failure result when the screen persists; otherwise returns null.
 *
 * @param page - the Playwright Page to check after OTP submission
 * @returns null when OTP was accepted, or a failure ScraperScrapingResult on rejection
 */
async function verifyOtpAccepted(page: Page): Promise<ScraperScrapingResult | null> {
  await sleep(5000);
  const isStillOnOtp = await detectOtpScreen(page);
  if (isStillOnOtp) {
    LOG.info('OTP screen still visible after submission — code was rejected');
    return {
      success: false,
      errorType: ScraperErrorTypes.InvalidOtp,
      errorMessage:
        'OTP code was rejected by the bank. The code may have expired or been entered incorrectly.',
    };
  }
  LOG.info('OTP accepted — proceeding with login');
  return null;
}

/**
 * Orchestrates the full OTP handling flow: detects the OTP screen, triggers SMS delivery,
 * invokes the retriever callback, fills and submits the code, and verifies acceptance.
 * Returns null when no OTP screen is detected, or a ScraperScrapingResult on error or rejection.
 *
 * @param page - the Playwright Page currently displayed after the login form was submitted
 * @param options - the scraper options, including the otpCodeRetriever callback and screenshot path
 * @returns null on success or when OTP is not needed, or a failure result when handling fails
 */
export async function handleOtpStep(
  page: Page,
  options: ScraperOptions,
): Promise<ScraperScrapingResult | null> {
  const isOtpDetected = await detectOtpScreen(page);
  if (!isOtpDetected) {
    LOG.info('No OTP screen detected — proceeding normally');
    return null;
  }
  LOG.info('OTP screen detected');

  const { otpCodeRetriever } = options;
  if (!otpCodeRetriever)
    return buildMissingRetrieverResult(page, options.storeFailureScreenShotPath);

  const phoneHint = await extractPhoneHint(page);
  await clickOtpTriggerIfPresent(page);
  await waitForPageStability(page);
  const code = await otpCodeRetriever(phoneHint);
  await fillAndSubmitOtpCode(page, code);
  return verifyOtpAccepted(page);
}

export default handleOtpStep;
