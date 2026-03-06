import { type Frame, type Page } from 'playwright';

import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions';
import { waitForRedirect } from '../../Common/Navigation';
import { resolveFieldContext } from '../../Common/SelectorResolver';
import { sleep } from '../../Common/Waiting';
import { CompanyTypes } from '../../Definitions';
import { type FieldConfig, type LoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Max];

// All three FieldConfigs scope to #login-password.tab-pane.active to avoid iframe false
// positives: wellKnown placeholder/ariaLabel candidates can match cross-origin iframes
// before reaching the CSS ID; the scoped formcontrolname selector targets only the main page.
const MAX_USERNAME_FIELD_CONFIG: FieldConfig = {
  credentialKey: 'username',
  selectors: [
    { kind: 'css', value: '#login-password.tab-pane.active [formcontrolname="username"]' },
    { kind: 'css', value: '#user-name' }, // CSS ID fallback
  ],
};
const MAX_PASSWORD_FIELD_CONFIG: FieldConfig = {
  credentialKey: 'password',
  selectors: [
    { kind: 'css', value: '#login-password.tab-pane.active [formcontrolname="password"]' },
    { kind: 'css', value: '#password' }, // CSS ID fallback
  ],
};
/** Selector for the Flow B ID field — only visible when Angular shows the second login step. */
const MAX_ID_SEL = '#login-password.tab-pane.active [formcontrolname="id"]';

/**
 * Checks whether the Max Flow B ID input field is currently visible on the page.
 *
 * @param page - the Playwright page to check for the ID field
 * @returns true if the ID field is visible (Flow B is active)
 */
async function isMaxIdFieldVisible(page: Page): Promise<boolean> {
  return page
    .locator(MAX_ID_SEL)
    .isVisible()
    .catch(() => false);
}

/**
 * Fills the username, password, and ID fields in the Max Flow B second login step.
 *
 * @param page - the Playwright page showing the second login form
 * @param credentials - the user credentials for the second step
 * @param credentials.username - the Max username
 * @param credentials.password - the Max password
 * @param credentials.id - the user's national ID number (ת.ז.)
 */
async function fillSecondStepFields(
  page: Page,
  credentials: { username: string; password: string; id: string },
): Promise<void> {
  const url = page.url();
  const userCtx = await resolveFieldContext(page, MAX_USERNAME_FIELD_CONFIG, url);
  const passCtx = await resolveFieldContext(page, MAX_PASSWORD_FIELD_CONFIG, url);
  if (userCtx.isResolved) await fillInput(userCtx.context, userCtx.selector, credentials.username);
  if (passCtx.isResolved) await fillInput(passCtx.context, passCtx.selector, credentials.password);
  await fillInput(page, MAX_ID_SEL, credentials.id);
  await clickButton(page, 'app-user-login-form .general-button.send-me-code');
  await sleep(1000);
}

/**
 * Handles the optional second-login step in Max's Flow B.
 * Detection uses CSS visibility (isVisible) — not DOM presence — to avoid false positives.
 *
 * @param page - the Playwright page after initial login form submission
 * @param credentials - the user credentials (id is optional, used only in Flow B)
 * @param credentials.username - the Max username
 * @param credentials.password - the Max password
 * @param credentials.id - optional national ID; required only when Flow B appears
 */
export async function maxHandleSecondLoginStep(
  page: Page,
  credentials: { username: string; password: string; id?: string },
): Promise<void> {
  if (!credentials.id) return;
  if (!(await isMaxIdFieldVisible(page))) return;
  await fillSecondStepFields(page, { ...credentials, id: credentials.id });
}

/**
 * First pre-action step: dismisses any popup and clicks the personal area link.
 *
 * @param page - the Playwright page on the Max home page
 */
async function maxPreActionStep1(page: Page): Promise<void> {
  if (await elementPresentOnPage(page, '#closePopup'))
    await page.$eval('#closePopup', el => {
      (el as HTMLElement).click();
    });
  await page.$eval('.personal-area > a.go-to-personal-area', el => {
    (el as HTMLElement).click();
  });
}

/**
 * Second pre-action step: clicks the private login link and waits for the password tab to activate.
 *
 * @param page - the Playwright page showing the Max login area
 */
async function maxPreActionStep2(page: Page): Promise<void> {
  if (await elementPresentOnPage(page, '.login-link#private'))
    await page.$eval('.login-link#private', el => {
      (el as HTMLElement).click();
    });
  await waitUntilElementFound(page, '#login-password-link', { visible: true });
  await page.$eval('#login-password-link', el => {
    (el as HTMLElement).click();
  });
  await waitUntilElementFound(page, '#login-password.tab-pane.active app-user-login-form', {
    visible: true,
  });
}

/**
 * Pre-login action that navigates from the Max home page to the password login form.
 *
 * @param page - the Playwright page on the Max home page
 * @returns undefined (login form is on the main page, not in a frame)
 */
async function maxPreAction(page: Page): Promise<Frame | undefined> {
  await maxPreActionStep1(page);
  await maxPreActionStep2(page);
  return undefined;
}

/**
 * Post-login action that waits for the Max homepage redirect or a login error popup.
 *
 * @param page - the Playwright page after form submission
 */
async function maxPostAction(page: Page): Promise<void> {
  if (page.url().startsWith(`${CFG.urls.base}/homepage`)) return;
  await Promise.race([
    waitForRedirect(page, {
      timeout: 20000,
      ignoreList: [CFG.urls.base, `${CFG.urls.base}/`],
    }),
    waitUntilElementFound(page, '#popupWrongDetails', { visible: true }),
    waitUntilElementFound(page, '#popupCardHoldersLoginError', { visible: true }),
  ]);
}

export const MAX_CONFIG: LoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] }, // wellKnown → #user-name
    { credentialKey: 'password', selectors: [] }, // wellKnown → #password
  ],
  submit: [{ kind: 'css', value: 'app-user-login-form .general-button.send-me-code' }],
  /**
   * Waits for the Max personal area link to appear before starting the login flow.
   *
   * @param page - the Playwright page on the Max home page
   */
  checkReadiness: async (page: Page) => {
    await waitUntilElementFound(page, '.personal-area > a.go-to-personal-area', { visible: true });
  },
  preAction: maxPreAction,
  postAction: maxPostAction,
  waitUntil: 'domcontentloaded',
  possibleResults: {
    // Covers /homepage/personal (old flow) and /homepage?SourceGA=... (ReturnURL-based flow).
    success: [/^https:\/\/www\.max\.co\.il\/homepage/],
    changePassword: [`${CFG.urls.base}/renew-password`],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, '#popupWrongDetails'))),
    ],
    unknownError: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, '#popupCardHoldersLoginError'))),
    ],
  },
};
