import path from 'path';
import { type Frame, type Page } from 'playwright';

import type { SelectorCandidate } from '../Scrapers/Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../Scrapers/Base/Errors.js';
import { type IScraperScrapingResult, type ScraperOptions } from '../Scrapers/Base/Interface.js';
import { getDebug } from './Debug.js';
import { clickButton, fillInput } from './ElementsInteractions.js';
import type { IParsedLoginPage } from './LoginMiddleware.js';
import {
  clickFromCandidates,
  clickOtpTriggerIfPresent,
  detectOtpScreen,
  extractPhoneHint,
  OTP_SUBMIT_CANDIDATES,
} from './OtpDetector.js';
import { candidateToCss, resolveFieldContext, tryInContext } from './SelectorResolver.js';

const LOG = getDebug('otp-handler');

const OTP_ANIMATION_DELAY_MS = 800;
const OTP_VERIFY_DELAY_MS = 5000;
const OTP_TRIGGER_DELAY_MS = 2000;

/**
 * Save a screenshot of the current page for OTP debugging.
 * @param page - The Playwright page to screenshot.
 * @param screenshotDir - Directory path where the screenshot will be saved.
 * @returns The full path to the saved screenshot file.
 */
async function saveScreenshot(page: Page, screenshotDir: string): Promise<string> {
  const nowMs = Date.now();
  const timestamp = String(nowMs);
  const screenshotPath = path.join(screenshotDir, `otp-required-${timestamp}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

/**
 * Build an error result when otpCodeRetriever is not configured.
 * @param page - The Playwright page for taking a diagnostic screenshot.
 * @param screenshotDir - Optional directory path for saving the screenshot.
 * @returns A scraping result indicating the retriever is missing.
 */
async function buildMissingRetrieverResult(
  page: Page,
  screenshotDir?: string,
): Promise<IScraperScrapingResult> {
  let errorMessage =
    'OTP screen detected but otpCodeRetriever is not set in options. ' +
    'Provide otpCodeRetriever to handle two-factor authentication.';
  if (screenshotDir) {
    try {
      const screenshotPath = await saveScreenshot(page, screenshotDir);
      errorMessage += ` Screenshot saved to ${screenshotPath}`;
    } catch (e: unknown) {
      LOG.debug(e, 'screenshot failed');
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
 * Check a single frame for an OTP input selector match.
 * @param frame - The frame to search within.
 * @param sel - The CSS selector to test.
 * @returns The frame if found, or false if not.
 */
async function checkFrameForSelector(frame: Frame, sel: string): Promise<Frame | false> {
  const el = await frame.$(sel).catch(() => null);
  if (el) {
    const frameUrl = frame.url().slice(-60);
    LOG.debug('OTP input found in frame %s via selector %s', frameUrl, sel);
    return frame;
  }
  return false;
}

/**
 * Find the frame containing the OTP input field by checking all selectors.
 * @param page - The Playwright page to search frames within.
 * @returns The matching frame, or an object with found:false if none matched.
 */
async function findOtpFillFrame(page: Page): Promise<Frame | { found: false }> {
  const frames = page.frames();
  const tasks = frames.flatMap(frame =>
    OTP_FILL_INPUT_SELECTORS.map(sel => checkFrameForSelector(frame, sel)),
  );
  const results = await Promise.all(tasks);
  const matchedFrame = results.find((f): f is Frame => f !== false);
  return matchedFrame ?? { found: false };
}

/**
 * Check a single OTP selector in the frame.
 * @param frame - The frame to search within.
 * @param sel - The CSS selector to test.
 * @returns The matched selector string, or false if not found.
 */
async function checkOtpSelector(frame: Frame, sel: string): Promise<string | false> {
  const el = await frame.$(sel).catch(() => null);
  return el ? sel : false;
}

/**
 * Inject OTP code via evaluate as a fallback when locator fails.
 * @param el - The element handle for the OTP input.
 * @param code - The OTP code to inject.
 * @returns True after injection completes.
 */
async function injectOtpViaEvaluate(
  el: NonNullable<Awaited<ReturnType<Frame['$']>>>,
  code: string,
): Promise<boolean> {
  await el.evaluate((input: HTMLInputElement, val: string) => {
    input.focus();
    input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, code);
  return true;
}

/**
 * Type OTP code into the matched input via locator with evaluate fallback.
 * @param frame - The frame containing the OTP input.
 * @param matchedSelector - The CSS selector for the OTP input.
 * @param code - The OTP code to type.
 * @returns True after the code is entered.
 */
async function typeOtpIntoField(
  frame: Frame,
  matchedSelector: string,
  code: string,
): Promise<boolean> {
  await frame.waitForTimeout(OTP_ANIMATION_DELAY_MS);
  const el = await frame.$(matchedSelector);
  try {
    const locator = frame.locator(matchedSelector).first();
    await locator.pressSequentially(code, { delay: 80 });
    LOG.debug('typed OTP code via locator selector: %s', matchedSelector);
  } catch (e: unknown) {
    LOG.debug(e, 'locator failed, falling back to evaluate injection');
    if (el) await injectOtpViaEvaluate(el, code);
  }
  return true;
}

/**
 * Type the OTP code into the input field within the given frame.
 * @param frame - The frame containing the OTP input.
 * @param code - The OTP code to type.
 * @returns True after the code is entered successfully.
 */
async function typeOtpCode(frame: Frame, code: string): Promise<boolean> {
  const selectorChecks = OTP_FILL_INPUT_SELECTORS.map(sel => checkOtpSelector(frame, sel));
  const selectorMatches = await Promise.all(selectorChecks);
  const matchedSelector = selectorMatches.find((s): s is string => s !== false);
  if (!matchedSelector) return true;
  return typeOtpIntoField(frame, matchedSelector, code);
}

/**
 * Check a single OTP submit candidate in the frame.
 * @param frame - The frame to search within.
 * @param candidate - The selector candidate to test.
 * @returns The matched selector and element, or false if not found.
 */
async function checkSubmitCandidate(
  frame: Frame,
  candidate: (typeof OTP_SUBMIT_CANDIDATES)[number],
): Promise<{ sel: string; el: NonNullable<Awaited<ReturnType<Frame['$']>>> } | false> {
  const sel = candidateToCss(candidate);
  const el = await frame.$(sel).catch(() => null);
  return el ? { sel, el } : false;
}

/**
 * Click the matched OTP submit button via evaluate.
 * @param el - The element handle to click.
 * @param sel - The CSS selector string for logging.
 * @returns True after the button is clicked.
 */
async function clickOtpSubmitButton(
  el: NonNullable<Awaited<ReturnType<Frame['$']>>>,
  sel: string,
): Promise<boolean> {
  const didClick = await el.evaluate((btn: HTMLElement) => {
    btn.removeAttribute('disabled');
    const win = window as Window &
      typeof globalThis & { $?: (s: string) => { trigger: (e: string) => boolean } };
    if (win.$ && btn.id) win.$(`#${btn.id}`).trigger('click');
    else btn.click();
    return true;
  });
  LOG.debug('clicked OTP submit button via evaluate: %s', sel);
  return didClick;
}

/**
 * Submit the OTP form by clicking the submit button in the frame.
 * @param frame - The frame containing the OTP submit button.
 * @returns True after submission attempt completes.
 */
async function submitOtpInFrame(frame: Frame): Promise<boolean> {
  const candidateChecks = OTP_SUBMIT_CANDIDATES.map(candidate =>
    checkSubmitCandidate(frame, candidate),
  );
  const candidateMatches = await Promise.all(candidateChecks);
  const matched = candidateMatches.find((m): m is Exclude<typeof m, false> => m !== false);
  if (!matched) {
    const frameUrl = frame.url().slice(-60);
    LOG.debug('no OTP submit button found in frame %s', frameUrl);
    return true;
  }
  return clickOtpSubmitButton(matched.el, matched.sel);
}

/**
 * Fill OTP code via resolveFieldContext fallback when no frame was found.
 * @param page - The Playwright page to resolve fields on.
 * @param code - The OTP code to fill.
 * @returns True after filling and optionally submitting.
 */
async function fillOtpViaResolver(page: Page, code: string): Promise<boolean> {
  const otpSelector = { kind: 'name' as const, value: 'otpCode' };
  const fieldConfig = { credentialKey: 'otpCode', selectors: [otpSelector] };
  const pageUrl = page.url();
  const resolved = await resolveFieldContext(page, fieldConfig, pageUrl);
  await fillInput(resolved.context, resolved.selector, code);
  const submitSel = await tryInContext(resolved.context, OTP_SUBMIT_CANDIDATES);
  if (submitSel) await clickButton(resolved.context, submitSel);
  return true;
}

/**
 * Fill the OTP code and submit, searching frames then falling back to resolveFieldContext.
 * @param page - The Playwright page to search for OTP fields.
 * @param code - The OTP code to fill and submit.
 * @returns True after filling and submitting the code.
 */
async function fillAndSubmitOtpCode(page: Page, code: string): Promise<boolean> {
  const frameResult = await findOtpFillFrame(page);
  if (!('url' in frameResult)) {
    LOG.debug('frame scan found nothing, falling back to resolveFieldContext');
    return fillOtpViaResolver(page, code);
  }
  const frame: Frame = frameResult;
  const frameUrl = frame.url().slice(-60);
  LOG.debug('filling OTP in frame: %s', frameUrl);
  await typeOtpCode(frame, code);
  await submitOtpInFrame(frame);
  return true;
}

const OTP_ACCEPTED_RESULT: IScraperScrapingResult = {
  success: true,
};

/**
 * Verify that the OTP was accepted by checking if the OTP screen is still visible.
 * @param page - The Playwright page to check after OTP submission.
 * @returns A failure result if OTP was rejected, or a success marker if accepted.
 */
async function verifyOtpAccepted(page: Page): Promise<IScraperScrapingResult> {
  await page.waitForTimeout(OTP_VERIFY_DELAY_MS);
  const isStillOnOtp = await detectOtpScreen(page);
  if (isStillOnOtp) {
    LOG.debug('OTP screen still visible after submission — code was rejected');
    return {
      success: false,
      errorType: ScraperErrorTypes.InvalidOtp,
      errorMessage:
        'OTP code was rejected by the bank. The code may have expired or been entered incorrectly.',
    };
  }
  LOG.debug('OTP accepted — proceeding with login');
  return OTP_ACCEPTED_RESULT;
}

/**
 * Confirm OTP delivery — click bank-specific confirm button if provided, then SMS trigger.
 * @param page - The Playwright page instance.
 * @param parsedPage - Optional parsed login page with child frame info.
 * @param triggerSelectors - Optional bank-specific confirm button selectors (from ILoginConfig.otp).
 * @returns The phone hint string extracted from the OTP screen.
 */
export async function handleOtpConfirm(
  page: Page,
  parsedPage?: IParsedLoginPage,
  triggerSelectors?: SelectorCandidate[],
): Promise<string> {
  const phoneHint = await extractPhoneHint(page);
  const childFrames = parsedPage?.childFrames;
  if (triggerSelectors) {
    LOG.debug('OTP confirm — clicking bank-specific confirm button (phone: %s)', phoneHint);
    await clickFromCandidates(page, triggerSelectors, childFrames);
    await page.waitForTimeout(OTP_TRIGGER_DELAY_MS);
  }
  LOG.debug('OTP confirm — clicking SMS trigger (phone: %s)', phoneHint);
  await clickOtpTriggerIfPresent(page, childFrames);
  await page.waitForTimeout(OTP_TRIGGER_DELAY_MS);
  return phoneHint;
}

const NO_OTP_RESULT: IScraperScrapingResult = {
  success: true,
};

/**
 * Enter OTP code — get code from user, fill, submit, verify.
 * @param page - The Playwright page instance.
 * @param options - Scraper options containing the OTP code retriever.
 * @param phoneHint - Optional phone hint to pass to the retriever.
 * @returns A scraping result indicating success or failure of OTP entry.
 */
export async function handleOtpCode(
  page: Page,
  options: ScraperOptions,
  phoneHint = '',
): Promise<IScraperScrapingResult> {
  const { otpCodeRetriever } = options;
  if (!otpCodeRetriever)
    return buildMissingRetrieverResult(page, options.storeFailureScreenShotPath);

  const hint = phoneHint || (await extractPhoneHint(page));
  LOG.debug('OTP code — requesting from retriever (phone: %s)', hint);
  const code = await otpCodeRetriever(hint);
  await fillAndSubmitOtpCode(page, code);
  return verifyOtpAccepted(page);
}

/**
 * Legacy combined handler — uses both confirm + code.
 * @param page - The Playwright page instance.
 * @param options - Scraper options containing the OTP code retriever.
 * @returns A scraping result indicating success or failure of OTP handling.
 */
export async function handleOtpStep(
  page: Page,
  options: ScraperOptions,
): Promise<IScraperScrapingResult> {
  const isOtpDetected = await detectOtpScreen(page);
  if (!isOtpDetected) {
    LOG.debug('No OTP screen detected — proceeding normally');
    return NO_OTP_RESULT;
  }
  LOG.debug('OTP screen detected');
  const phoneHint = await handleOtpConfirm(page);
  return handleOtpCode(page, options, phoneHint);
}
