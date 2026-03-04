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
 * Handles the optional second-login step in Max's Flow B:
 *   home → username+password → 2nd form (username+password+ID) → dashboard
 * Detection uses CSS visibility (isVisible) — not DOM presence — to avoid false positives:
 * Angular keeps [formcontrolname="id"] in the DOM for both flows, CSS-hidden in Flow A.
 * If the ID form is not visible (Flow A), this function is a no-op.
 */
export async function maxHandleSecondLoginStep(
  page: Page,
  credentials: { username: string; password: string; id?: string },
): Promise<void> {
  if (!credentials.id) return;
  if (
    !(await page
      .locator(MAX_ID_SEL)
      .isVisible()
      .catch(() => false))
  )
    return;
  const url = page.url();
  const userCtx = await resolveFieldContext(page, MAX_USERNAME_FIELD_CONFIG, url);
  const passCtx = await resolveFieldContext(page, MAX_PASSWORD_FIELD_CONFIG, url);
  if (userCtx.isResolved) await fillInput(userCtx.context, userCtx.selector, credentials.username);
  if (passCtx.isResolved) await fillInput(passCtx.context, passCtx.selector, credentials.password);
  await fillInput(page, MAX_ID_SEL, credentials.id);
  await clickButton(page, 'app-user-login-form .general-button.send-me-code');
  await sleep(1000);
}

async function maxPreActionStep1(page: Page): Promise<void> {
  if (await elementPresentOnPage(page, '#closePopup'))
    await page.$eval('#closePopup', el => {
      (el as HTMLElement).click();
    });
  await page.$eval('.personal-area > a.go-to-personal-area', el => {
    (el as HTMLElement).click();
  });
}

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

async function maxPreAction(page: Page): Promise<Frame | undefined> {
  await maxPreActionStep1(page);
  await maxPreActionStep2(page);
  return undefined;
}

async function maxPostAction(page: Page): Promise<void> {
  if (page.url().includes('/homepage/personal')) return;
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
  checkReadiness: async (page: Page) => {
    await waitUntilElementFound(page, '.personal-area > a.go-to-personal-area', { visible: true });
  },
  preAction: maxPreAction,
  postAction: maxPostAction,
  waitUntil: 'domcontentloaded',
  possibleResults: {
    success: [`${CFG.urls.base}/homepage/personal`],
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
