import { type Frame, type Page } from 'playwright';

import { type SelectorCandidate } from '../Scrapers/Base/LoginConfig.js';
import { getDebug } from './Debug.js';
import { tryInContext } from './SelectorResolver.js';

const LOG = getDebug('otp-detector');

// OTP text patterns — Hebrew + English, most-specific first
const OTP_TEXT_PATTERNS = [
  'סיסמה חד פעמית',
  'קוד חד פעמי',
  'אימות זהות',
  'לצורך אימות',
  'בחר טלפון',
  'שלח קוד',
  'קוד SMS',
  'קוד אימות',
  'one-time password',
  'SMS code',
] as const;

const OTP_INPUT_CANDIDATES: SelectorCandidate[] = [
  { kind: 'placeholder', value: 'קוד חד פעמי' },
  { kind: 'placeholder', value: 'קוד SMS' },
  { kind: 'placeholder', value: 'קוד אימות' },
  { kind: 'placeholder', value: 'הזן קוד' },
  { kind: 'ariaLabel', value: 'קוד' },
  { kind: 'name', value: 'otpCode' },
  { kind: 'css', value: '#sendSms' },
  { kind: 'css', value: '#codeinput' },
];

const PHONE_PATTERN = /[*]{4,}\d{2,4}/;

export const OTP_SUBMIT_CANDIDATES: SelectorCandidate[] = [
  { kind: 'xpath', value: '//button[contains(.,"אשר")]' },
  { kind: 'xpath', value: '//button[contains(.,"המשך")]' },
  { kind: 'xpath', value: '//button[contains(.,"אישור")]' },
  { kind: 'xpath', value: '//button[contains(.,"כניסה")]' },
  { kind: 'ariaLabel', value: 'כניסה' },
  { kind: 'css', value: 'button[type="submit"]' },
  { kind: 'css', value: 'input[type="button"]' },
];

const SMS_TRIGGER_CANDIDATES: SelectorCandidate[] = [
  { kind: 'css', value: '#sendSms' },
  { kind: 'xpath', value: '//button[contains(.,"SMS")]' },
  { kind: 'ariaLabel', value: 'שלח SMS' },
  { kind: 'css', value: 'input[type="radio"][value="SMS"]' },
  { kind: 'xpath', value: '//button[contains(.,"שלח")]' },
  { kind: 'xpath', value: '//button[contains(.,"קבל קוד")]' },
];

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
  } catch (e: unknown) {
    LOG.debug(e, 'getBodyText failed (page context inaccessible)');
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
 * Detect OTP presence by searching for known OTP input fields on the page and in frames.
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
 * Detect whether the current page is showing an OTP screen.
 * @param page - The Playwright page to check for OTP indicators.
 * @returns True if an OTP screen is detected.
 */
export async function detectOtpScreen(page: Page): Promise<boolean> {
  const textResult = await detectByText(page);
  if (textResult === 'otp') {
    LOG.debug('OTP detected by text pattern');
    return true;
  }
  if (textResult === 'unknown') {
    LOG.debug('Page context inaccessible — skipping OTP input check');
    return false;
  }
  const isByInput = await detectByInputField(page);
  if (isByInput) LOG.debug('OTP detected by input field');
  return isByInput;
}

/**
 * Extract the masked phone number hint from the OTP screen body text.
 * @param page - The Playwright page to search for the phone hint.
 * @returns The matched phone hint string, or empty string if not found.
 */
export async function extractPhoneHint(page: Page): Promise<string> {
  const bodyText = await getBodyText(page);
  const matched = PHONE_PATTERN.exec(bodyText);
  return matched?.[0] ?? '';
}

/**
 * Find the Playwright selector for the OTP submit button across all frames.
 * @param page - The Playwright page to search for submit buttons.
 * @returns The matched selector (CSS or XPath), or empty string if not found.
 */
export async function findOtpSubmitSelector(page: Page): Promise<string> {
  const main = await tryInContext(page, OTP_SUBMIT_CANDIDATES);
  if (main) return main;
  const mainFrame = page.mainFrame();
  const nonMainFrames = page.frames().filter(f => f !== mainFrame);
  const frameTasks = nonMainFrames.map(frame => tryInContext(frame, OTP_SUBMIT_CANDIDATES));
  const results = await Promise.all(frameTasks);
  return results.find(sel => sel.length > 0) ?? '';
}

/** Result of an SMS trigger search with selector and context. */
interface ISmsTriggerResult {
  selector: string;
  context: Page | Frame;
}

/**
 * Search all frames for an SMS trigger button.
 * @param page - The Playwright page to search.
 * @param cachedFrames - Optional pre-filtered list of child frames.
 * @returns The trigger selector and context, or empty selector if not found.
 */
async function findSmsTriggerInFrames(
  page: Page,
  cachedFrames?: Frame[],
): Promise<ISmsTriggerResult> {
  const mainSel = await tryInContext(page, SMS_TRIGGER_CANDIDATES);
  if (mainSel) return { selector: mainSel, context: page };
  const mainFrame = page.mainFrame();
  const frames = cachedFrames ?? page.frames().filter(f => f !== mainFrame);
  const frameTasks = frames.map(async (frame): Promise<ISmsTriggerResult | false> => {
    const sel = await tryInContext(frame, SMS_TRIGGER_CANDIDATES);
    return sel ? { selector: sel, context: frame } : false;
  });
  const results = await Promise.all(frameTasks);
  const found = results.find((r): r is ISmsTriggerResult => r !== false);
  return found ?? { selector: '', context: page };
}

/**
 * Click the SMS trigger button if one is found on the page or in frames.
 * @param page - The Playwright page to search for SMS triggers.
 * @param cachedFrames - Optional pre-filtered list of child frames.
 * @returns True after the trigger is clicked or skipped.
 */
export async function clickOtpTriggerIfPresent(
  page: Page,
  cachedFrames?: Frame[],
): Promise<boolean> {
  const trigger = await findSmsTriggerInFrames(page, cachedFrames);
  if (trigger.selector) {
    LOG.debug('clicking SMS trigger: %s', trigger.selector);
    await trigger.context.click(trigger.selector);
  } else {
    LOG.debug('No SMS trigger found — SMS may be auto-sent');
  }
  return true;
}
