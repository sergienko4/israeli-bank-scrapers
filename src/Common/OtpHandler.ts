import path from 'path';
import { type Frame, type Page } from 'playwright';

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
import { candidateToCss, resolveFieldContext, tryInContext } from './SelectorResolver';
import { sleep } from './Waiting';

const LOG = getDebug('otp-handler');

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

async function findOtpFillFrame(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    for (const sel of OTP_FILL_INPUT_SELECTORS) {
      const el = await frame.$(sel).catch(() => null);
      if (el) {
        LOG.info('OTP input found in frame %s via selector %s', frame.url().slice(-60), sel);
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
      await frame.locator(sel).first().pressSequentially(code, { delay: 80 });
      LOG.info('typed OTP code via locator.type() selector: %s', sel);
    } catch (e: unknown) {
      LOG.info(e, 'locator.type() failed, falling back to evaluate injection');
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
    LOG.info('clicked OTP submit button via evaluate: %s', sel);
    return;
  }
  LOG.info('no OTP submit button found in frame %s', frame.url().slice(-60));
}

async function fillAndSubmitOtpCode(page: Page, code: string): Promise<void> {
  const frame = await findOtpFillFrame(page);
  if (frame) {
    LOG.info('filling OTP in frame: %s', frame.url().slice(-60));
    await typeOtpCode(frame, code);
    await submitOtpInFrame(frame);
    return;
  }
  LOG.info('fillAndSubmitOtpCode: frame scan found nothing, falling back to resolveFieldContext');
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
  const code = await otpCodeRetriever(phoneHint);
  await fillAndSubmitOtpCode(page, code);
  return verifyOtpAccepted(page);
}
