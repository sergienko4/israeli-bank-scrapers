import type { Page } from 'playwright';

import type { LifecyclePromise } from '../../../Scrapers/Base/Interfaces/CallbackTypes.js';
import { setupRequestInterception } from './RequestInterceptor.js';

// ── HTML Fixtures ────────────────────────────────────────────────────────────

/** Login form -> clicking "כניסה" shows the OTP selection screen (JS-rendered, no URL change) */
export const OTP_SELECTION_HTML = `<!DOCTYPE html><html><body dir="rtl">
<div id="login-form">
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button id="login-btn" type="button" onclick="showPhoneSelect()">כניסה</button>
</div>
<div id="phone-select" style="display:none">
  <p>לצורך אימות זהותך, יש לבחור טלפון לקבלת סיסמה חד פעמית</p>
  <span id="phone-hint">*****5100</span>
  <button id="sms-btn" type="button" onclick="showCodeEntry()">SMS</button>
  <button id="sms-send-btn" type="button" onclick="showCodeEntry()">שלח</button>
</div>
<div id="code-entry" style="display:none">
  <input id="otp-input" placeholder="קוד חד פעמי" />
  <button id="otp-submit" type="button"
    onclick="window.location.href='https://test-bank.local/dashboard'">אשר</button>
</div>
<script>
  function showPhoneSelect() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('phone-select').style.display = 'block';
  }
  function showCodeEntry() {
    document.getElementById('phone-select').style.display = 'none';
    document.getElementById('code-entry').style.display = 'block';
  }
</script>
</body></html>`;

/** Simple OTP code-entry screen (no phone selection step) */
export const OTP_CODE_ENTRY_HTML = `<!DOCTYPE html><html><body dir="rtl">
<div id="login-form">
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button id="login-btn" type="button" onclick="showOtp()">כניסה</button>
</div>
<div id="otp-form" style="display:none">
  <p>לצורך אימות זהותך יש להזין סיסמה חד פעמית</p>
  <input id="otp-input" placeholder="קוד חד פעמי" />
  <button id="otp-submit" type="button"
    onclick="window.location.href='https://test-bank.local/dashboard'">אשר</button>
</div>
<script>
  function showOtp() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('otp-form').style.display = 'block';
  }
</script>
</body></html>`;

/** Normal login -- no OTP at all */
export const NORMAL_LOGIN_HTML = `<!DOCTYPE html><html><body>
<form>
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button id="login-btn" type="button"
    onclick="window.location.href='https://test-bank.local/dashboard'">כניסה</button>
</form>
</body></html>`;

/** Login error page -- wrong credentials, no OTP keywords */
export const LOGIN_ERROR_HTML = `<!DOCTYPE html><html><body dir="rtl">
<form>
  <input type="text" placeholder="שם משתמש" />
  <input type="password" placeholder="סיסמה" />
  <button id="login-btn" type="button"
    onclick="window.location.href='https://test-bank.local/error'">כניסה</button>
</form>
<p id="error-msg" style="display:none">שם משתמש שגוי. ניסיון 2 מתוך 3</p>
</body></html>`;

/** Two-screen OTP -- Beinleumi-like: phone hint + "שלח" -> OTP input + "אישור" */
export const OTP_CONFIRM_THEN_CODE_HTML = `<!DOCTYPE html><html><body dir="rtl">
<div id="login-form">
  <input type="text" placeholder="שם משתמש" />
  <input type="password" id="password" placeholder="סיסמה" />
  <button id="login-btn" type="button" onclick="showConfirm()">כניסה</button>
</div>
<div id="otp-confirm" style="display:none">
  <p>לצורך אימות זהותך, יש לבחור טלפון לקבלת סיסמה חד פעמית</p>
  <span id="phone-hint">*****5100</span>
  <button id="send-btn" type="button" onclick="showCodeEntry()">שלח</button>
</div>
<div id="code-entry" style="display:none">
  <input id="otp-input" placeholder="קוד חד פעמי" />
  <button id="otp-submit" type="button" onclick="submitOtp()">אישור</button>
</div>
<script>
  function showConfirm() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('otp-confirm').style.display = 'block';
  }
  function showCodeEntry() {
    document.getElementById('otp-confirm').remove();
    document.getElementById('code-entry').style.display = 'block';
  }
  function submitOtp() {
    document.getElementById('code-entry').style.display = 'none';
    window.location.href = 'https://test-bank.local/dashboard';
  }
</script>
</body></html>`;

export const DASHBOARD_HTML = '<!DOCTYPE html><html><body><h1>Dashboard</h1></body></html>';
export const ERROR_PAGE_HTML =
  '<!DOCTYPE html><html><body><p>שם משתמש שגוי. ניסיון 2 מתוך 3</p></body></html>';

// ── Test Helpers ─────────────────────────────────────────────────────────────

/** Route entry for request interception. */
interface IRouteEntry {
  match: string;
  contentType: string;
  body: string;
}

/** Callback signature for preparePage scraper option. */
type PreparePage = (page: Page) => LifecyclePromise;

/**
 * Build a preparePage callback that sets up request interception with the given routes.
 * @param routes - The route entries to intercept.
 * @returns An async preparePage function for scraper options.
 */
export function buildPreparePage(routes: IRouteEntry[]): PreparePage {
  return async page => {
    await setupRequestInterception(page, routes);
  };
}

/**
 * Build a preparePage for a standard login+dashboard pair.
 * @param loginHtml - The HTML to serve on the login URL.
 * @returns An async preparePage function.
 */
export function buildLoginDashboardPage(loginHtml: string): PreparePage {
  return buildPreparePage([
    { match: 'test-bank.local/login', contentType: 'text/html; charset=utf-8', body: loginHtml },
    {
      match: 'test-bank.local/dashboard',
      contentType: 'text/html; charset=utf-8',
      body: DASHBOARD_HTML,
    },
  ]);
}

/**
 * Build a preparePage for a login+error pair.
 * @param loginHtml - The HTML to serve on the login URL.
 * @returns An async preparePage function.
 */
export function buildLoginErrorPage(loginHtml: string): PreparePage {
  return buildPreparePage([
    { match: 'test-bank.local/login', contentType: 'text/html; charset=utf-8', body: loginHtml },
    {
      match: 'test-bank.local/error',
      contentType: 'text/html; charset=utf-8',
      body: ERROR_PAGE_HTML,
    },
  ]);
}
