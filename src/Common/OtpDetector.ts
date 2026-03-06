import { type Page } from 'playwright';

import { type SelectorCandidate } from '../Scrapers/Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Scrapers/Registry/ScraperConfig';
import { getDebug } from './Debug';
import { tryInContext } from './SelectorResolver';

const LOG = getDebug('otp-detector');

const CFG = SCRAPER_CONFIGURATION.otp;
const OTP_INPUT_CANDIDATES: SelectorCandidate[] = [
  ...SCRAPER_CONFIGURATION.wellKnownSelectors.otpCode,
];
export const OTP_SUBMIT_CANDIDATES: SelectorCandidate[] = [...CFG.submitSelectors];
const SMS_TRIGGER_CANDIDATES: SelectorCandidate[] = [...CFG.smsTriggerSelectors];

type TextCheckResult = 'otp' | 'clear' | 'unknown';

/**
 * Extracts the visible inner text of the page body for OTP keyword detection.
 * Returns null when the page context is inaccessible due to navigation.
 *
 * @param page - the Playwright Page to extract text from
 * @returns the body innerText string, or null on evaluation failure
 */
async function getBodyText(page: Page): Promise<string | null> {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    return typeof text === 'string' ? text : null;
  } catch (e: unknown) {
    LOG.info(e, 'getBodyText failed (page context inaccessible)');
    return null;
  }
}

/**
 * Checks whether the page body text contains any of the configured OTP indicator patterns.
 * Returns 'unknown' when the page context is inaccessible, 'otp' on a match, or 'clear'.
 *
 * @param page - the Playwright Page to inspect
 * @returns 'otp' if an OTP pattern is found, 'clear' if not, or 'unknown' on context failure
 */
async function detectByText(page: Page): Promise<TextCheckResult> {
  const bodyText = await getBodyText(page);
  if (bodyText === null) return 'unknown';
  return CFG.textPatterns.some(p => bodyText.includes(p)) ? 'otp' : 'clear';
}

/**
 * Checks whether an OTP input field is present on the main page or in any child iframe.
 *
 * @param page - the Playwright Page to search for an OTP input element
 * @returns true when an OTP input is found on the page or in any child frame
 */
async function detectByInputField(page: Page): Promise<boolean> {
  const found = await tryInContext(page, OTP_INPUT_CANDIDATES);
  if (found) return true;
  const childFrames = page.frames().filter(f => f !== page.mainFrame());
  const frameContextChecks = childFrames.map(f => tryInContext(f, OTP_INPUT_CANDIDATES));
  const frameResults = await Promise.all(frameContextChecks);
  return frameResults.some(r => r !== null);
}

/**
 * Determines whether the current page is an OTP verification screen by checking body text
 * patterns first and falling back to OTP input field detection.
 *
 * @param page - the Playwright Page to inspect for OTP screen indicators
 * @returns true when an OTP screen is detected, false otherwise
 */
export async function detectOtpScreen(page: Page): Promise<boolean> {
  const textResult = await detectByText(page);
  if (textResult === 'otp') {
    LOG.info('OTP detected by text pattern');
    return true;
  }
  if (textResult === 'unknown') {
    LOG.info('Page context inaccessible — skipping OTP input check');
    return false;
  }
  const isByInput = await detectByInputField(page);
  if (isByInput) LOG.info('OTP detected by input field');
  return isByInput;
}

/**
 * Extracts a partial phone number hint from the OTP page body text (e.g. "05X-XXXX123"),
 * which is passed to the otpCodeRetriever so the user knows which phone received the code.
 *
 * @param page - the Playwright Page showing the OTP screen
 * @returns the first phone number pattern match found in the body text, or an empty string
 */
export async function extractPhoneHint(page: Page): Promise<string> {
  const bodyText = await getBodyText(page);
  return bodyText?.match(CFG.phonePattern)?.[0] ?? '';
}

/**
 * Searches the main page and all child iframes for a submit button matching the OTP submit candidates.
 *
 * @param page - the Playwright Page to search for an OTP submit button
 * @returns the CSS selector string for the first matching submit button, or null if none is found
 */
export async function findOtpSubmitSelector(page: Page): Promise<string | null> {
  const main = await tryInContext(page, OTP_SUBMIT_CANDIDATES);
  if (main) return main;
  const submitFrames = page.frames().filter(f => f !== page.mainFrame());
  const submitFrameChecks = submitFrames.map(f => tryInContext(f, OTP_SUBMIT_CANDIDATES));
  const frameResults = await Promise.all(submitFrameChecks);
  return frameResults.find(r => r !== null) ?? null;
}

/**
 * Attempts to click a single SMS trigger selector inside the #loginFrame iframe.
 * Returns false silently when the element is not found or the click fails.
 *
 * @param page - the Playwright Page containing the #loginFrame iframe
 * @param sel - the CSS selector of the SMS trigger button to click
 * @returns true when the click succeeded, false otherwise
 */
async function tryOneTrigger(page: Page, sel: string): Promise<boolean> {
  try {
    const locator = page.frameLocator('#loginFrame').locator(sel);
    await locator.waitFor({ state: 'attached', timeout: 5000 });
    await locator.hover();
    await locator.click();
    LOG.info('isClicked SMS trigger in #loginFrame: %s', sel);
    return true;
  } catch (e: unknown) {
    LOG.info('SMS trigger failed for %s: %s', sel, e instanceof Error ? e.message.slice(0, 80) : e);
    return false;
  }
}

/**
 * Tries each selector in the triggers list sequentially inside the #loginFrame iframe,
 * stopping at the first successful click.
 *
 * @param page - the Playwright Page containing the #loginFrame iframe
 * @param triggers - an ordered list of CSS selectors to try for the SMS trigger button
 * @returns true when at least one trigger was successfully clicked, false otherwise
 */
async function tryLoginFrameTriggers(page: Page, triggers: string[]): Promise<boolean> {
  const initial = Promise.resolve(false);
  return triggers.reduce(async (acc, sel) => (await acc) || tryOneTrigger(page, sel), initial);
}

/**
 * Clicks the given selector inside an arbitrary child frame, logging the frame URL for diagnostics.
 *
 * @param frame - a minimal frame-like object with `click` and `url` methods
 * @param frame.click - the click method to invoke with the selector
 * @param frame.url - returns the frame's current URL for log messages
 * @param sel - the CSS selector of the element to click within the frame
 * @returns always true — indicates the click was attempted
 */
async function tryClickInFrame(
  frame: { click: (sel: string) => Promise<void>; url: () => string },
  sel: string,
): Promise<boolean> {
  const frameUrl = frame.url();
  LOG.info('clicking SMS trigger in iframe %s: %s', frameUrl, sel);
  await frame.click(sel);
  return true;
}

/**
 * Searches all child frames (except the main frame) for the first SMS trigger candidate
 * and clicks it when found.
 *
 * @param page - the Playwright Page whose child frames are searched
 * @returns true when an SMS trigger was found and clicked in a child frame, false otherwise
 */
async function tryFramesTriggers(page: Page): Promise<boolean> {
  const childFrames = page.frames().filter(f => f !== page.mainFrame());
  const frameSelectorChecks = childFrames.map(f => tryInContext(f, SMS_TRIGGER_CANDIDATES));
  const selectorResults = await Promise.all(frameSelectorChecks);
  const firstIdx = selectorResults.findIndex(s => s !== null);
  const firstSel = selectorResults[firstIdx];
  if (!firstSel) return false;
  await tryClickInFrame(childFrames[firstIdx], firstSel);
  return true;
}

/**
 * Attempts to click an SMS send trigger on the main page first; if not found, searches child frames.
 * Logs a diagnostic message when no trigger is found (SMS may be sent automatically).
 *
 * @param page - the Playwright Page to search for an SMS trigger button
 */
async function tryGenericFrameTriggers(page: Page): Promise<void> {
  const mainSelector = await tryInContext(page, SMS_TRIGGER_CANDIDATES);
  if (mainSelector) {
    LOG.info('clicking SMS trigger on main page: %s', mainSelector);
    await page.click(mainSelector);
    return;
  }
  const isFound = await tryFramesTriggers(page);
  if (!isFound)
    LOG.info(
      'No SMS trigger button found — SMS may be auto-sent or page is already on entry screen',
    );
}

/**
 * Attempts to trigger SMS OTP delivery by clicking known send-SMS buttons on the page.
 * Tries #loginFrame-scoped selectors first, then falls back to generic page and iframe search.
 * Does nothing when no trigger button is found (some banks send SMS automatically).
 *
 * @param page - the Playwright Page to search for an SMS trigger button
 */
export async function clickOtpTriggerIfPresent(page: Page): Promise<void> {
  const loginFrameTriggers = [
    '#sendSms',
    'xpath=//button[contains(.,"שלח")]',
    'xpath=//button[contains(.,"SMS")]',
  ];
  const isClicked = await tryLoginFrameTriggers(page, loginFrameTriggers);
  if (!isClicked) {
    await tryGenericFrameTriggers(page);
  }
}
