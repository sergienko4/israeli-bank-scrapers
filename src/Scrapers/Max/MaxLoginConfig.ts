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

// FieldConfig for the ID field — selectors empty so SelectorResolver falls back to wellKnownSelectors.id
const MAX_ID_FIELD_CONFIG: FieldConfig = { credentialKey: 'id', selectors: [] };

/**
 * Handles the optional second-login step in Max's Flow B:
 *   home → username+password → 2nd form (username+password+ID) → dashboard
 * Uses wellKnownSelectors.id from ScraperConfig to detect the field.
 * If the ID form is not present (Flow A), this function is a no-op.
 */
export async function maxHandleSecondLoginStep(
  page: Page,
  credentials: { username: string; password: string; id?: string },
): Promise<void> {
  if (!credentials.id) return;
  const idCtx = await resolveFieldContext(page, MAX_ID_FIELD_CONFIG, page.url());
  if (!idCtx.isResolved) return;
  await fillInput(page, '#user-name', credentials.username);
  await fillInput(page, '#password', credentials.password);
  await fillInput(idCtx.context, idCtx.selector, credentials.id);
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
