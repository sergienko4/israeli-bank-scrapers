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
  return CFG.textPatterns.some(p => bodyText.includes(p)) ? 'otp' : 'clear';
}

async function detectByInputField(page: Page): Promise<boolean> {
  const found = await tryInContext(page, OTP_INPUT_CANDIDATES);
  if (found) return true;
  const childFrames = page.frames().filter(f => f !== page.mainFrame());
  const frameResults = await Promise.all(
    childFrames.map(f => tryInContext(f, OTP_INPUT_CANDIDATES)),
  );
  return frameResults.some(r => r !== null);
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
  return bodyText?.match(CFG.phonePattern)?.[0] ?? '';
}

export async function findOtpSubmitSelector(page: Page): Promise<string | null> {
  const main = await tryInContext(page, OTP_SUBMIT_CANDIDATES);
  if (main) return main;
  const submitFrames = page.frames().filter(f => f !== page.mainFrame());
  const frameResults = await Promise.all(
    submitFrames.map(f => tryInContext(f, OTP_SUBMIT_CANDIDATES)),
  );
  return frameResults.find(r => r !== null) ?? null;
}

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

async function tryLoginFrameTriggers(page: Page, triggers: string[]): Promise<boolean> {
  return triggers.reduce(
    async (acc, sel) => (await acc) || tryOneTrigger(page, sel),
    Promise.resolve(false),
  );
}

async function tryClickInFrame(
  frame: { click: (sel: string) => Promise<void>; url: () => string },
  sel: string,
): Promise<boolean> {
  LOG.info('clicking SMS trigger in iframe %s: %s', frame.url(), sel);
  await frame.click(sel);
  return true;
}

async function tryFramesTriggers(page: Page): Promise<boolean> {
  const childFrames = page.frames().filter(f => f !== page.mainFrame());
  const selectorResults = await Promise.all(
    childFrames.map(f => tryInContext(f, SMS_TRIGGER_CANDIDATES)),
  );
  const firstIdx = selectorResults.findIndex(s => s !== null);
  const firstSel = selectorResults[firstIdx];
  if (!firstSel) return false;
  await tryClickInFrame(childFrames[firstIdx], firstSel);
  return true;
}

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
