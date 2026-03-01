import { type Frame, type Page } from 'playwright';
import path from 'path';
import { getDebug } from './Debug';
import { fillInput, clickButton } from './ElementsInteractions';
import { type ScraperOptions, type ScraperScrapingResult } from '../Scrapers/Interface';
import { ScraperErrorTypes } from '../Scrapers/Errors';
import { candidateToCss, resolveFieldContext, tryInContext } from './SelectorResolver';
import {
  detectOtpScreen,
  extractPhoneHint,
  clickOtpTriggerIfPresent,
  OTP_SUBMIT_CANDIDATES,
} from './OtpDetector';
import { sleep } from './Waiting';

const DEBUG = getDebug('otp-handler');

const OTP_ANIMATION_DELAY_MS = 800;

async function saveScreenshot(page: Page, screenshotDir: string): Promise<string> {
  const screenshotPath = path.join(screenshotDir, `otp-required-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

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
      DEBUG('screenshot failed: %O', e);
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

async function findOtpFillFrame(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    for (const sel of OTP_FILL_INPUT_SELECTORS) {
      const el = await frame.$(sel).catch(() => null);
      if (el) {
        DEBUG('OTP input found in frame %s via selector %s', frame.url().slice(-60), sel);
        return frame;
      }
    }
  }
  return null;
}

async function typeOtpCode(frame: Frame, code: string): Promise<void> {
  for (const sel of OTP_FILL_INPUT_SELECTORS) {
    const el = await frame.$(sel).catch(() => null);
    if (!el) continue;
    await sleep(OTP_ANIMATION_DELAY_MS);
    try {
      await frame.locator(sel).first().type(code, { delay: 80 });
      DEBUG('typed OTP code via locator.type() selector: %s', sel);
    } catch (e: unknown) {
      DEBUG('locator.type() failed (%O), falling back to evaluate injection', e);
      await el.evaluate((input: HTMLInputElement, val: string) => {
        input.focus();
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, code);
    }
    return;
  }
}

async function submitOtpInFrame(frame: Frame): Promise<void> {
  for (const candidate of OTP_SUBMIT_CANDIDATES) {
    const sel = candidateToCss(candidate);
    const el = await frame.$(sel).catch(() => null);
    if (!el) continue;
    await el.evaluate((btn: HTMLElement) => {
      btn.removeAttribute('disabled');
      const win = window as Window &
        typeof globalThis & { $?: (s: string) => { trigger: (e: string) => void } };
      if (win.$ && btn.id) win.$(`#${btn.id}`).trigger('click');
      else btn.click();
    });
    DEBUG('clicked OTP submit button via evaluate: %s', sel);
    return;
  }
  DEBUG('no OTP submit button found in frame %s', frame.url().slice(-60));
}

async function fillAndSubmitOtpCode(page: Page, code: string): Promise<void> {
  const frame = await findOtpFillFrame(page);
  if (frame) {
    DEBUG('filling OTP in frame: %s', frame.url().slice(-60));
    await typeOtpCode(frame, code);
    await submitOtpInFrame(frame);
    return;
  }
  DEBUG('fillAndSubmitOtpCode: frame scan found nothing, falling back to resolveFieldContext');
  const { selector: inputSelector, context } = await resolveFieldContext(
    page,
    { credentialKey: 'otpCode', selectors: [{ kind: 'name', value: 'otpCode' }] },
    page.url(),
  );
  await fillInput(context, inputSelector, code);
  const submitSelector = await tryInContext(context, OTP_SUBMIT_CANDIDATES);
  if (submitSelector) await clickButton(context, submitSelector);
}

async function verifyOtpAccepted(page: Page): Promise<ScraperScrapingResult | null> {
  await sleep(5000);
  const isStillOnOtp = await detectOtpScreen(page);
  if (isStillOnOtp) {
    DEBUG('OTP screen still visible after submission — code was rejected');
    return {
      success: false,
      errorType: ScraperErrorTypes.InvalidOtp,
      errorMessage:
        'OTP code was rejected by the bank. The code may have expired or been entered incorrectly.',
    };
  }
  DEBUG('OTP accepted — proceeding with login');
  return null;
}

export async function handleOtpStep(
  page: Page,
  options: ScraperOptions,
): Promise<ScraperScrapingResult | null> {
  const isOtpDetected = await detectOtpScreen(page);
  if (!isOtpDetected) {
    DEBUG('No OTP screen detected — proceeding normally');
    return null;
  }
  DEBUG('OTP screen detected');

  const { otpCodeRetriever } = options;
  if (!otpCodeRetriever)
    return buildMissingRetrieverResult(page, options.storeFailureScreenShotPath);

  const phoneHint = await extractPhoneHint(page);
  await clickOtpTriggerIfPresent(page);
  const code = await otpCodeRetriever(phoneHint);
  await fillAndSubmitOtpCode(page, code);
  return verifyOtpAccepted(page);
}
