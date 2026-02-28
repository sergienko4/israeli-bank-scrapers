import { type Frame, type Page } from 'playwright';
import path from 'path';
import { getDebug } from './debug';
import { fillInput, clickButton } from './elements-interactions';
import { type ScraperOptions, type ScraperScrapingResult } from '../scrapers/interface';
import { ScraperErrorTypes } from '../scrapers/errors';
import { resolveFieldContext, tryInContext } from './selector-resolver';
import { detectOtpScreen, extractPhoneHint, clickOtpTriggerIfPresent, OTP_SUBMIT_CANDIDATES } from './otp-detector';
import { sleep } from './waiting';

const debug = getDebug('otp-handler');

async function saveScreenshot(page: Page, screenshotDir: string): Promise<string> {
  const screenshotPath = path.join(screenshotDir, `otp-required-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function buildMissingRetrieverResult(page: Page, screenshotDir?: string): Promise<ScraperScrapingResult> {
  let errorMessage =
    'OTP screen detected but otpCodeRetriever is not set in options. ' +
    'Provide otpCodeRetriever to handle two-factor authentication.';
  if (screenshotDir) {
    try {
      const screenshotPath = await saveScreenshot(page, screenshotDir);
      errorMessage += ` Screenshot saved to ${screenshotPath}`;
    } catch {
      // screenshot failed — ignore
    }
  }
  return { success: false, errorType: ScraperErrorTypes.TwoFactorRetrieverMissing, errorMessage };
}

// OTP input selectors — ordered most-specific first.
// Scanned across ALL frames so no frame ID needs to be hardcoded.
// Mirrors the pattern of WELL_KNOWN_SELECTORS but for OTP code entry inputs.
const OTP_FILL_INPUT_SELECTORS = [
  '#codeinput',                                              // Beinleumi
  'input[placeholder*="סיסמה"]:not([id="password"])',       // Beinleumi alt
  'input[placeholder*="קוד חד פעמי"]',
  'input[placeholder*="קוד SMS"]',
  'input[placeholder*="קוד אימות"]',
  'input[placeholder*="הזן קוד"]',
  'input[placeholder*="one-time"]',
  'input[type="tel"]',                                       // generic tel input
  '[name="otpCode"]',
];

/** Returns the first frame (including main) that contains an OTP code input. */
async function findOtpFillFrame(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    for (const sel of OTP_FILL_INPUT_SELECTORS) {
      const el = await frame.$(sel).catch(() => null);
      if (el) {
        debug('OTP input found in frame %s via selector %s', frame.url().slice(-60), sel);
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
    // Wait for CSS animations (~800ms) then fire real key events
    await new Promise(r => setTimeout(r, 800));
    try {
      await frame.locator(sel).first().type(code, { delay: 80 });
      console.log('[OTP-WAIT] typed code via locator.type() selector:', sel);
    } catch {
      await el.evaluate((input: HTMLInputElement, val: string) => {
        input.focus();
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, code);
      console.log('[OTP-WAIT] typed code via evaluate fallback selector:', sel);
    }
    return;
  }
}

async function submitOtpInFrame(frame: Frame): Promise<void> {
  for (const candidate of OTP_SUBMIT_CANDIDATES) {
    const sel = (await import('./selector-resolver')).candidateToCss(candidate);
    const el = await frame.$(sel).catch(() => null);
    if (!el) continue;
    await el.evaluate((btn: HTMLElement) => {
      btn.removeAttribute('disabled');
      const win = window as Window & typeof globalThis & { $?: (s: string) => { trigger: (e: string) => void } };
      if (win.$ && btn.id) win.$(`#${btn.id}`).trigger('click');
      else btn.click();
    });
    console.log('[OTP-SUBMIT] clicked via evaluate:', sel);
    return;
  }
  debug('no OTP submit button found in frame %s', frame.url().slice(-60));
}

async function fillAndSubmitOtpCode(page: Page, code: string): Promise<void> {
  // Scan all frames for the OTP input — works for any iframe structure or no iframe at all.
  // No frame ID is hardcoded; the input content (selector list) drives discovery.
  const frame = await findOtpFillFrame(page);
  if (frame) {
    console.log('[OTP-WAIT] found OTP input in frame:', frame.url().slice(-60));
    await typeOtpCode(frame, code);
    await submitOtpInFrame(frame);
    return;
  }

  // Last resort: resolveFieldContext Round 3 + Round 4 iframe search
  debug('fillAndSubmitOtpCode: frame scan found nothing, falling back to resolveFieldContext');
  const { selector: inputSelector, context } = await resolveFieldContext(
    page,
    { credentialKey: 'otpCode', selectors: [{ kind: 'name', value: 'otpCode' }] },
    page.url(),
  );
  await fillInput(context, inputSelector, code);
  const submitSelector = await tryInContext(context, OTP_SUBMIT_CANDIDATES);
  if (submitSelector) await clickButton(context, submitSelector);
}

/**
 * Check for an OTP screen after login form submission.
 *
 * Returns null  → no OTP screen detected, caller should continue the normal login flow.
 * Returns result → OTP screen was detected; either handled (continues via caller's postAction)
 *                  or an error (TwoFactorRetrieverMissing / InvalidOtp) is returned immediately.
 */
export async function handleOtpStep(page: Page, options: ScraperOptions): Promise<ScraperScrapingResult | null> {
  const otpDetected = await detectOtpScreen(page);
  if (!otpDetected) {
    debug('No OTP screen detected — proceeding normally');
    return null;
  }
  debug('OTP screen detected');

  const { otpCodeRetriever } = options;
  if (!otpCodeRetriever) {
    return buildMissingRetrieverResult(page, options.storeFailureScreenShotPath);
  }

  const phoneHint = await extractPhoneHint(page); // extract before trigger hides the hint
  await clickOtpTriggerIfPresent(page);
  const code = await otpCodeRetriever(phoneHint);
  await fillAndSubmitOtpCode(page, code);

  // Wait for the bank to process the OTP, then verify the screen has gone away.
  // If the OTP screen is still visible after 5 s, the code was rejected.
  await sleep(5000);
  const stillOnOtp = await detectOtpScreen(page);
  if (stillOnOtp) {
    debug('OTP screen still visible after submission — code was rejected');
    return {
      success: false,
      errorType: ScraperErrorTypes.InvalidOtp,
      errorMessage: 'OTP code was rejected by the bank. The code may have expired or been entered incorrectly.',
    };
  }

  debug('OTP accepted — proceeding with login');
  return null;
}
