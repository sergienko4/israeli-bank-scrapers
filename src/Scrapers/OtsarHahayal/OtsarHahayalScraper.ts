import { type Page } from 'playwright-core';

import { type ILoginConfig } from '../Base/Config/LoginConfig.js';
import { type ScraperOptions } from '../Base/Interface.js';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup.js';
import { beinleumiConfig } from '../BaseBeinleumiGroup/Config/BeinleumiLoginConfig.js';

/**
 * The OtsarHahayal login form is loaded inside a dynamically-injected iframe
 * (id="loginFrame") whose src is only set when the user opens the login modal.
 * The scraper never triggers the modal, so navigating to the main bank URL
 * leaves the iframe as about:blank and the credential fields are never found.
 *
 * Fix: navigate directly to the Mataf login servlet — the same page that the
 * iframe would load — where the username/password fields are immediately available.
 * This also removes the 15-second waitForAnyIframe timeout since the form is
 * on the top-level page and no preAction iframe search is needed.
 */
const OTSAR_LOGIN_URL =
  'https://online.bankotsar.co.il/MatafLoginService/MatafLoginServlet?bankId=OTSARPRTAL&site=Private&KODSAFA=HE';

/**
 * After OTP is accepted, OtsarHahayal stays on the MatafLoginServlet path
 * but strips query parameters (the SPA drops ?bankId=... on transition to
 * the authenticated state). Beinleumi-group success patterns (fibi/FibiMenu)
 * never match bankotsar.co.il URLs, so we provide bank-specific conditions.
 */
const OTSAR_POSSIBLE_RESULTS = {
  success: [
    /online\.bankotsar\.co\.il\/MatafLoginService\/MatafLoginServlet$/, // post-OTP (no query)
    /bankotsar\.co\.il\/wps\/portal/, // dashboard if navigation goes further
  ],
  invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
};

/** Maximum ms to wait for the post-OTP URL to settle before result check. */
const OTSAR_POST_ACTION_TIMEOUT_MS = 10000;

/**
 * Wait for the Mataf servlet URL to settle (query params stripped) after OTP.
 * @param page - The Playwright page to watch.
 */
async function otsarPostAction(
  page: Page,
): ReturnType<NonNullable<ILoginConfig['postAction']>> {
  try {
    await page.waitForURL(/MatafLoginServlet$/, { timeout: OTSAR_POST_ACTION_TIMEOUT_MS });
  } catch { /* navigation timeout — proceed to result check */ }
}

/** Scraper for Otsar Hahayal — uses Beinleumi group login flow with a direct login URL. */
class OtsarHahayalScraper extends BeinleumiGroupBaseScraper {
  /**
   * Build an OtsarHahayal scraper.
   * @param options - Scraper configuration options.
   */
  constructor(options: ScraperOptions) {
    const loginConfig = {
      ...beinleumiConfig(OTSAR_LOGIN_URL),
      // The login servlet is a plain form page — no iframe modal to wait for.
      preAction: undefined,
      // The submit button is <input id="continueBtn" type="button"> —
      // its label comes from the `value` attribute, not innerText,
      // so text-based selectors don't match it.
      submit: [
        { kind: 'css' as const, value: '#continueBtn' },
        { kind: 'clickableText' as const, value: 'כניסה' },
      ],
      postAction: otsarPostAction,
      possibleResults: OTSAR_POSSIBLE_RESULTS,
    };
    super(options, loginConfig);
  }
}

export default OtsarHahayalScraper;
