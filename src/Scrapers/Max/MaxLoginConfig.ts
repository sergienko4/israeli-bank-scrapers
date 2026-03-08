import { type Frame, type Page } from 'playwright';

import {
  clickButton,
  elementPresentOnPage,
  fillInput,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions.js';
import { resolveFieldContext } from '../../Common/SelectorResolver.js';
import { sleep } from '../../Common/Waiting.js';
import { CompanyTypes } from '../../Definitions.js';
import { type FieldConfig, type LoginConfig } from '../Base/LoginConfig.js';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Max];

// FieldConfig constants — selectors empty so SelectorResolver falls back to wellKnownSelectors
const MAX_USERNAME_FIELD: FieldConfig = { credentialKey: 'username', selectors: [] };
const MAX_PASSWORD_FIELD: FieldConfig = { credentialKey: 'password', selectors: [] };
const MAX_ID_FIELD: FieldConfig = { credentialKey: 'id', selectors: [] };

async function resolveAndFill(page: Page, field: FieldConfig, value: string): Promise<void> {
  const ctx = await resolveFieldContext(page, field, page.url());
  if (!ctx.isResolved) return;
  await fillInput(ctx.context, ctx.selector, value);
}

/**
 * Handles the optional second-login step in Max's Flow B:
 *   home → username+password → 2nd form (username+password+ID) → dashboard
 * Uses wellKnownSelectors to detect all fields via SelectorResolver.
 * If the ID form is not present (Flow A), this function is a no-op.
 */
export async function maxHandleSecondLoginStep(
  page: Page,
  credentials: { username: string; password: string; id?: string },
): Promise<void> {
  if (!credentials.id) return;
  const idCtx = await resolveFieldContext(page, MAX_ID_FIELD, page.url());
  if (!idCtx.isResolved) return;
  await resolveAndFill(page, MAX_USERNAME_FIELD, credentials.username);
  await resolveAndFill(page, MAX_PASSWORD_FIELD, credentials.password);
  await fillInput(idCtx.context, idCtx.selector, credentials.id);
  await clickButton(page, 'app-user-login-form .general-button.send-me-code');
  await sleep(1000);
}

async function clickFirstVisible(page: Page, texts: string[]): Promise<void> {
  for (const text of texts) {
    const loc = page.locator(`text=${text}`).first();
    if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) {
      await loc.click();
      return;
    }
  }
  // fallback: force-click the first candidate that exists in DOM
  for (const text of texts) {
    const loc = page.locator(`text=${text}`).first();
    if ((await loc.count()) > 0) {
      await loc.click({ force: true });
      return;
    }
  }
}

async function maxPreAction(page: Page): Promise<Frame | undefined> {
  if (await elementPresentOnPage(page, '#closePopup'))
    await page.$eval('#closePopup', (el: HTMLElement) => {
      el.click();
    });
  // Navigate: "כניסה לאיזור האישי" → "לקוחות פרטיים" → "כניסה עם סיסמה"
  await clickFirstVisible(page, ['כניסה לאיזור האישי']);
  await sleep(1500);
  await clickFirstVisible(page, ['לקוחות פרטיים']);
  await sleep(500);
  await clickFirstVisible(page, ['כניסה עם סיסמה']);
  await page.waitForSelector('input[placeholder*="שם משתמש"]', {
    state: 'visible',
    timeout: 15000,
  });
  return undefined;
}

async function maxPostAction(page: Page): Promise<void> {
  if (page.url().startsWith('https://www.max.co.il/homepage')) return;
  await Promise.race([
    page.waitForURL('**/homepage/**', { timeout: 20000 }),
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
  submit: [
    { kind: 'xpath', value: '//button[contains(., "כניסה")]' },
    { kind: 'css', value: 'app-user-login-form .general-button.send-me-code' },
  ],
  checkReadiness: async (page: Page) => {
    await page.waitForSelector('text=כניסה לאיזור האישי', { state: 'visible', timeout: 15000 });
  },
  preAction: maxPreAction,
  postAction: maxPostAction,
  waitUntil: 'domcontentloaded',
  possibleResults: {
    success: [
      (opts): boolean => {
        const url = opts?.page?.url() ?? '';
        return url.startsWith('https://www.max.co.il/homepage');
      },
    ],
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
