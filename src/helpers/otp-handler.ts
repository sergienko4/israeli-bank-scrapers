import { type Page } from 'playwright';
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

async function fillAndSubmitOtpCode(page: Page, code: string): Promise<void> {
  // Beinleumi new portal: OTP form is inside #loginFrame (cross-origin from online.fibi.co.il).
  // Confirmed selectors from real recording:
  //   Input:  #codeinput  type="tel"  placeholder="יש להקליד סיסמה"
  //   Submit: button[type="submit"]
  try {
    const frame = page.frameLocator('#loginFrame');
    // Wait for the OTP code input to appear (appears after #sendSms is clicked)
    const otpInput = frame.locator(
      '#codeinput, input[type="tel"], input[placeholder*="סיסמה"]:not([id="password"]), input[placeholder*="קוד"]',
    ).first();
    // Wait for #codeinput to be attached (user must have clicked שלח to make it appear)
    console.log('[OTP-WAIT] waiting for #codeinput in #loginFrame (user must have clicked שלח)...');
    await otpInput.waitFor({ state: 'attached', timeout: 30000 });
    console.log('[OTP-WAIT] found #codeinput, waiting for CSS animation then typing...');
    // Wait for CSS fadeInDown animation to complete (~300ms) before typing
    await new Promise(r => setTimeout(r, 800));
    // Use locator.type() — fires real keydown+keypress+keyup events that bank's jQuery validates
    try {
      await otpInput.type(code, { delay: 80 });
      console.log('[OTP-WAIT] typed code via locator.type()');
    } catch {
      // If type fails (element not interactive), fall back to evaluate injection
      console.log('[OTP-WAIT] type() failed, using evaluate fallback...');
      await otpInput.evaluate((el: HTMLInputElement, val: string) => {
        el.focus();
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      }, code);
    }
    debug('filled OTP in #loginFrame');
    // Try multiple submit button selectors — use evaluate for reliable clicking
    const submitSelectors = ['button[type="submit"]', '#continueBtn', 'input[type="button"][aria-label*="כניסה"]'];
    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = frame.locator(sel).first();
        await btn.waitFor({ state: 'attached', timeout: 5000 });
        await btn.evaluate((el: HTMLElement) => {
          el.removeAttribute('disabled');
          // Try jQuery click first (fires jQuery event handlers), then native click
          const win = window as Window & typeof globalThis & { $?: (s: string) => { trigger: (e: string) => void } };
          if (win.$ && el.id) {
            win.$(`#${el.id}`).trigger('click');
          } else {
            el.click();
          }
        });
        console.log('[OTP-SUBMIT] clicked via evaluate:', sel);
        submitted = true;
        break;
      } catch (e: unknown) {
        console.log('[OTP-SUBMIT] failed for', sel, ':', e instanceof Error ? e.message.slice(0, 60) : e);
      }
    }
    if (submitted) return;
    throw new Error('no submit button found in loginFrame');
  } catch (e: unknown) {
    console.log('[OTP-FILL-ERR]', e instanceof Error ? e.message.slice(0, 100) : e);
    debug('fillAndSubmitOtpCode fell back to resolveFieldContext');
  }

  // Fallback for banks without #loginFrame
  const { selector: inputSelector, context } = await resolveFieldContext(
    page,
    { credentialKey: 'otpCode', selectors: [{ kind: 'name', value: 'otpCode' }] },
    page.url(),
  );
  console.log(`[OTP-FILL] input selector: ${inputSelector}`);
  await fillInput(context, inputSelector, code);
  const submitSelector = await tryInContext(context, OTP_SUBMIT_CANDIDATES);
  console.log(`[OTP-SUBMIT] submit selector: ${submitSelector ?? 'NOT FOUND'}`);
  if (submitSelector) {
    await clickButton(context, submitSelector);
  }
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
