import { type Page } from 'playwright';
import { getDebug } from './debug';
import { tryInContext } from './selector-resolver';
import { type SelectorCandidate } from '../scrapers/login-config';

const debug = getDebug('otp-detector');

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
  // ariaLabel 'קוד' kept for detection — it triggers on the Beinleumi SPA's OTP form
  // (loginFrame iframe). It's also a false-positive risk on carousel buttons, but that
  // is acceptable for detection; the fill step uses WELL_KNOWN_SELECTORS (no ariaLabel 'קוד').
  { kind: 'ariaLabel', value: 'קוד' },
  { kind: 'name', value: 'otpCode' },
  // Beinleumi "choose phone" screen: #sendSms appears BEFORE #codeinput.
  // Detecting it here ensures OTP handling starts before the user clicks שלח.
  { kind: 'css', value: '#sendSms' },
  // Beinleumi OTP code-entry screen (after שלח click): explicit id match.
  { kind: 'css', value: '#codeinput' },
];

const PHONE_PATTERN = /[*]{4,}\d{2,4}/;

// "שלח" intentionally excluded — it means "send/resend" and is a trigger, not a submit.
// NOTE: some banks (e.g. Beinleumi) use <input type="button"> not <button>, so XPath
//       //button[...] won't match them — the ariaLabel and input[type="button"] candidates cover those.
// Exported so otp-handler can reuse it to search in the OTP input's frame context.
export const OTP_SUBMIT_CANDIDATES: SelectorCandidate[] = [
  { kind: 'xpath', value: '//button[contains(.,"אשר")]' },
  { kind: 'xpath', value: '//button[contains(.,"המשך")]' },
  { kind: 'xpath', value: '//button[contains(.,"אישור")]' },
  { kind: 'xpath', value: '//button[contains(.,"כניסה")]' },
  { kind: 'ariaLabel', value: 'כניסה' }, // Beinleumi: <input type="button" aria-label="כניסה">
  { kind: 'css', value: 'button[type="submit"]' },
  { kind: 'css', value: 'input[type="button"]' }, // fallback for banks using <input> instead of <button>
];

// Buttons that trigger SENDING the OTP (before the code-entry screen appears).
// "אישור" intentionally excluded — it doubles as an OTP submit button on code-entry screens.
// Only unambiguous "send SMS" signals are kept here.
const SMS_TRIGGER_CANDIDATES: SelectorCandidate[] = [
  { kind: 'css', value: '#sendSms' }, // Beinleumi: direct id match — fastest and most reliable
  { kind: 'xpath', value: '//button[contains(.,"SMS")]' },
  { kind: 'ariaLabel', value: 'שלח SMS' },
  { kind: 'css', value: 'input[type="radio"][value="SMS"]' },
  { kind: 'xpath', value: '//button[contains(.,"שלח")]' },
  { kind: 'xpath', value: '//button[contains(.,"קבל קוד")]' }, // "get code" button
];

type TextCheckResult = 'otp' | 'clear' | 'unknown';

/**
 * Fetches document.body.innerText safely.
 * Returns null when the page context is inaccessible (navigating, cross-origin, test mocks).
 */
async function getBodyText(page: Page): Promise<string | null> {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    return typeof text === 'string' ? text : null;
  } catch (e: unknown) {
    debug('getBodyText failed (page context inaccessible): %O', e);
    return null;
  }
}

/**
 * 'otp'     — body text contains a known OTP keyword
 * 'clear'   — body text is accessible and contains no OTP keywords
 * 'unknown' — page context is inaccessible (navigating, mock env, cross-origin)
 */
async function detectByText(page: Page): Promise<TextCheckResult> {
  const bodyText = await getBodyText(page);
  if (bodyText === null) return 'unknown';
  return OTP_TEXT_PATTERNS.some(pattern => bodyText.includes(pattern)) ? 'otp' : 'clear';
}

async function detectByInputField(page: Page): Promise<boolean> {
  const found = await tryInContext(page, OTP_INPUT_CANDIDATES);
  if (found) return true;
  for (const frame of page.frames().filter(f => f !== page.mainFrame())) {
    const inFrame = await tryInContext(frame, OTP_INPUT_CANDIDATES);
    if (inFrame) return true;
  }
  return false;
}

/**
 * Returns true if the current page appears to be an OTP/2FA screen.
 * Text check runs first (fast). Input check runs only when text is accessible
 * but contains no OTP keywords — skipped when page context is inaccessible
 * (navigating, test mocks), preventing false-positives.
 */
export async function detectOtpScreen(page: Page): Promise<boolean> {
  const textResult = await detectByText(page);
  if (textResult === 'otp') {
    debug('OTP detected by text pattern');
    return true;
  }
  if (textResult === 'unknown') {
    debug('Page context inaccessible — skipping OTP input check');
    return false;
  }
  const byInput = await detectByInputField(page);
  if (byInput) debug('OTP detected by input field');
  return byInput;
}

/**
 * Extracts a masked phone hint like "******5100" from the page text.
 * Returns empty string if not found.
 */
export async function extractPhoneHint(page: Page): Promise<string> {
  const bodyText = await getBodyText(page);
  return bodyText?.match(PHONE_PATTERN)?.[0] ?? '';
}

/**
 * Returns the first OTP submit button selector + frame context found on the page or in iframes.
 * Tries Hebrew button labels (אשר, המשך, אישור, כניסה), aria-label "כניסה",
 * button[type="submit"], and input[type="button"] as a fallback.
 */
export async function findOtpSubmitSelector(page: Page): Promise<string | null> {
  const main = await tryInContext(page, OTP_SUBMIT_CANDIDATES);
  if (main) return main;
  for (const frame of page.frames().filter(f => f !== page.mainFrame())) {
    const inFrame = await tryInContext(frame, OTP_SUBMIT_CANDIDATES);
    if (inFrame) return inFrame;
  }
  return null;
}

/**
 * Clicks the SMS "send/confirm" trigger button if one is present on the page or in a child iframe.
 *
 * SPA portals (e.g. Beinleumi new portal) render the OTP form asynchronously.
 * We wait up to 5 s for the #sendSms button to appear before doing a broader search,
 * which prevents tryInContext from returning null before the DOM has settled.
 */
export async function clickOtpTriggerIfPresent(page: Page): Promise<void> {
  // Beinleumi new portal: OTP form is inside #loginFrame (cross-origin from online.fibi.co.il).
  // Playwright's FrameLocator API reliably crosses origin boundaries for both wait and click.
  // Try the three most common SMS trigger selectors inside #loginFrame first.
  const loginFrameTriggers = ['#sendSms', 'xpath=//button[contains(.,"שלח")]', 'xpath=//button[contains(.,"SMS")]'];
  for (const sel of loginFrameTriggers) {
    try {
      const locator = page.frameLocator('#loginFrame').locator(sel);
      await locator.waitFor({ state: 'attached', timeout: 5000 });
      // Use full Playwright click with hover for complete mouse event sequence
      // Standard Playwright click: CDP Input.dispatchMouseEvent → isTrusted=true in Chromium.
      // force:true was removed — it skips scroll/focus steps the bank's handler may need.
      await locator.hover();
      await locator.click();
      debug('clicked SMS trigger in #loginFrame: %s', sel);
      return;
    } catch (e: unknown) {
      debug('SMS trigger failed for %s: %s', sel, e instanceof Error ? e.message.slice(0, 80) : e);
    }
  }

  // Fallback: search main page and generic child iframes
  const mainSelector = await tryInContext(page, SMS_TRIGGER_CANDIDATES);
  if (mainSelector) {
    debug('clicking SMS trigger on main page: %s', mainSelector);
    await page.click(mainSelector);
    return;
  }
  for (const frame of page.frames().filter(f => f !== page.mainFrame())) {
    const sel = await tryInContext(frame, SMS_TRIGGER_CANDIDATES);
    if (sel) {
      debug('clicking SMS trigger in iframe %s: %s', frame.url(), sel);
      await frame.click(sel);
      return;
    }
  }
  debug('No SMS trigger button found — SMS may be auto-sent or page is already on entry screen');
}
