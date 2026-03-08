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

async function getBodyText(page: Page): Promise<string | null> {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    return typeof text === 'string' ? text : null;
  } catch (e: unknown) {
    LOG.info(e, 'getBodyText failed (page context inaccessible)');
    return null;
  }
}

async function detectByText(page: Page): Promise<TextCheckResult> {
  const bodyText = await getBodyText(page);
  if (bodyText === null) return 'unknown';
  return OTP_TEXT_PATTERNS.some(pattern => bodyText.includes(pattern)) ? 'otp' : 'clear';
}

async function detectByInputField(page: Page, cachedFrames?: Frame[]): Promise<boolean> {
  const found = await tryInContext(page, OTP_INPUT_CANDIDATES);
  if (found) return true;
  const frames = cachedFrames ?? page.frames().filter(f => f !== page.mainFrame());
  for (const frame of frames) {
    const inFrame = await tryInContext(frame, OTP_INPUT_CANDIDATES);
    if (inFrame) return true;
  }
  return false;
}

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

export async function extractPhoneHint(page: Page): Promise<string> {
  const bodyText = await getBodyText(page);
  return bodyText?.match(PHONE_PATTERN)?.[0] ?? '';
}

export async function findOtpSubmitSelector(page: Page): Promise<string | null> {
  const main = await tryInContext(page, OTP_SUBMIT_CANDIDATES);
  if (main) return main;
  for (const frame of page.frames().filter(f => f !== page.mainFrame())) {
    const inFrame = await tryInContext(frame, OTP_SUBMIT_CANDIDATES);
    if (inFrame) return inFrame;
  }
  return null;
}

async function findSmsTriggerInFrames(
  page: Page,
  cachedFrames?: Frame[],
): Promise<{ selector: string; context: Page | Frame } | null> {
  const mainSel = await tryInContext(page, SMS_TRIGGER_CANDIDATES);
  if (mainSel) return { selector: mainSel, context: page };
  const frames = cachedFrames ?? page.frames().filter(f => f !== page.mainFrame());
  for (const frame of frames) {
    const sel = await tryInContext(frame, SMS_TRIGGER_CANDIDATES);
    if (sel) return { selector: sel, context: frame };
  }
  return null;
}

export async function clickOtpTriggerIfPresent(page: Page, cachedFrames?: Frame[]): Promise<void> {
  const trigger = await findSmsTriggerInFrames(page, cachedFrames);
  if (trigger) {
    LOG.info('clicking SMS trigger: %s', trigger.selector);
    await trigger.context.click(trigger.selector);
  } else {
    LOG.info('No SMS trigger found — SMS may be auto-sent');
  }
}
