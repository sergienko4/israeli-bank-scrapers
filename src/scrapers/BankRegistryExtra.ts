import { type Page } from 'playwright';
import {
  elementPresentOnPage,
  pageEvalAll,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../Helpers/ElementsInteractions';
import { waitForNavigation, waitForRedirect } from '../Helpers/Navigation';
import { type LoginConfig } from './LoginConfig';

const HAPOALIM_BASE = 'https://login.bankhapoalim.co.il';

const LEUMI_INVALID_PASSWORD_MSG = 'אחד או יותר מפרטי ההזדהות שמסרת שגויים. ניתן לנסות שוב';
const LEUMI_ACCOUNT_BLOCKED_MSG = 'המנוי חסום';

const MIZRAHI_CHECKING_ACCOUNT_HE = 'עובר ושב';
const MIZRAHI_CHECKING_ACCOUNT_EN = 'Checking Account';
const MIZRAHI_INVALID_SELECTOR =
  'a[href*="https://sc.mizrahi-tefahot.co.il/SCServices/SC/P010.aspx"]';

async function leumiCheckReadiness(page: Page): Promise<void> {
  await waitUntilElementFound(page, '.enter_account');
  const loginUrl = await page.$eval('.enter_account', el => (el as HTMLAnchorElement).href);
  await page.goto(loginUrl);
  await waitForNavigation(page, { waitUntil: 'networkidle' });
  await Promise.all([
    waitUntilElementFound(page, 'input[placeholder="שם משתמש"]', { visible: true }),
    waitUntilElementFound(page, 'input[placeholder="סיסמה"]', { visible: true }),
    waitUntilElementFound(page, 'button[type="submit"]', { visible: true }),
  ]);
}

async function leumiPostAction(page: Page): Promise<void> {
  await Promise.race([
    waitUntilElementFound(page, 'a[title="דלג לחשבון"]', { visible: true, timeout: 60000 }),
    waitUntilElementFound(page, 'div.main-content', { visible: false, timeout: 60000 }),
    page.waitForSelector(`xpath=//div[contains(string(),"${LEUMI_INVALID_PASSWORD_MSG}")]`),
    waitUntilElementFound(page, 'form[action="/changepassword"]', {
      visible: true,
      timeout: 60000,
    }),
  ]);
}

async function mizrahiIsLoggedIn(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  const xpath = `//a//span[contains(., "${MIZRAHI_CHECKING_ACCOUNT_HE}") or contains(., "${MIZRAHI_CHECKING_ACCOUNT_EN}")]`;
  return (await opts.page.$$(`xpath=${xpath}`)).length > 0;
}

async function mizrahiPostAction(page: Page): Promise<void> {
  await Promise.race([
    waitUntilElementFound(page, '#dropdownBasic'),
    waitUntilElementFound(page, MIZRAHI_INVALID_SELECTOR),
    waitForNavigation(page),
  ]);
}

async function maxPreActionStep1(page: Page): Promise<void> {
  if (await elementPresentOnPage(page, '#closePopup'))
    await page.$eval('#closePopup', el => (el as HTMLElement).click());
  await page.$eval('.personal-area > a.go-to-personal-area', el => (el as HTMLElement).click());
}

async function maxPreActionStep2(page: Page): Promise<void> {
  if (await elementPresentOnPage(page, '.login-link#private'))
    await page.$eval('.login-link#private', el => (el as HTMLElement).click());
  await waitUntilElementFound(page, '#login-password-link', { visible: true });
  await page.$eval('#login-password-link', el => (el as HTMLElement).click());
  await waitUntilElementFound(page, '#login-password.tab-pane.active app-user-login-form', {
    visible: true,
  });
}

async function maxPreAction(page: Page): Promise<void> {
  await maxPreActionStep1(page);
  await maxPreActionStep2(page);
}

async function maxPostAction(page: Page): Promise<void> {
  await Promise.race([
    waitForRedirect(page, {
      timeout: 20000,
      ignoreList: ['https://www.max.co.il', 'https://www.max.co.il/'],
    }),
    waitUntilElementFound(page, '#popupWrongDetails', { visible: true }),
    waitUntilElementFound(page, '#popupCardHoldersLoginError', { visible: true }),
  ]);
}

async function yahavPostAction(page: Page): Promise<void> {
  await waitForNavigation(page);
  await waitUntilElementDisappear(page, '.loader');
  if (await elementPresentOnPage(page, '.messaging-links-container')) {
    await page.$eval('.link-1', el => (el as HTMLElement).click());
  }
  await Promise.race([
    waitUntilElementFound(page, '#AccountDetails'),
    waitUntilElementFound(page, 'input#ef_req_parameter_old_credential'),
  ]);
}

export const HAPOALIM_CONFIG: LoginConfig = {
  loginUrl: `${HAPOALIM_BASE}/cgi-bin/poalwwwc?reqName=getLogonPage`,
  fields: [
    { credentialKey: 'userCode', selectors: [{ kind: 'css', value: '#userCode' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#password' }] },
  ],
  submit: [
    { kind: 'css', value: '.login-btn' },
    { kind: 'ariaLabel', value: 'כניסה' },
  ],
  postAction: async (page: Page) => {
    await waitForRedirect(page, {});
  },
  possibleResults: {
    success: [
      `${HAPOALIM_BASE}/portalserver/HomePage`,
      `${HAPOALIM_BASE}/ng-portals-bt/rb/he/homepage`,
      `${HAPOALIM_BASE}/ng-portals/rb/he/homepage`,
    ],
    invalidPassword: [
      `${HAPOALIM_BASE}/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false`,
    ],
    changePassword: [
      `${HAPOALIM_BASE}/MCP/START?flow=MCP&state=START&expiredDate=null`,
      /\/ABOUTTOEXPIRE\/START/i,
    ],
  },
};

export const LEUMI_CONFIG: LoginConfig = {
  loginUrl: 'https://www.leumi.co.il/he',
  fields: [
    { credentialKey: 'username', selectors: [{ kind: 'placeholder', value: 'שם משתמש' }] },
    { credentialKey: 'password', selectors: [{ kind: 'placeholder', value: 'סיסמה' }] },
  ],
  submit: [{ kind: 'css', value: "button[type='submit']" }],
  checkReadiness: leumiCheckReadiness,
  postAction: leumiPostAction,
  possibleResults: {
    success: [/ebanking\/SO\/SPA.aspx/i],
    invalidPassword: [
      async opts => {
        if (!opts?.page) return false;
        const msg = await pageEvalAll(opts.page, {
          selector: 'svg#Capa_1',
          defaultResult: '',
          callback: el => (el[0]?.parentElement?.children[1] as HTMLDivElement)?.innerText,
        });
        return msg?.startsWith(LEUMI_INVALID_PASSWORD_MSG) ?? false;
      },
    ],
    accountBlocked: [
      async opts => {
        if (!opts?.page) return false;
        const msg = await pageEvalAll(opts.page, {
          selector: '.errHeader',
          defaultResult: '',
          callback: el => (el[0] as HTMLElement)?.innerText,
        });
        return msg?.startsWith(LEUMI_ACCOUNT_BLOCKED_MSG) ?? false;
      },
    ],
    changePassword: ['https://hb2.bankleumi.co.il/authenticate'],
  },
};

export const MIZRAHI_CONFIG: LoginConfig = {
  loginUrl: 'https://www.mizrahi-tefahot.co.il/login/index.html#/auth-page-he',
  fields: [
    { credentialKey: 'username', selectors: [{ kind: 'css', value: '#userNumberDesktopHeb' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#passwordDesktopHeb' }] },
  ],
  submit: [{ kind: 'css', value: 'button.btn.btn-primary' }],
  checkReadiness: async (page: Page) => {
    await waitUntilElementDisappear(page, 'div.ngx-overlay.loading-foreground');
  },
  postAction: mizrahiPostAction,
  possibleResults: {
    success: [/https:\/\/mto\.mizrahi-tefahot\.co\.il\/OnlineApp\/.*/i, mizrahiIsLoggedIn],
    invalidPassword: [
      async opts => !!(opts?.page && (await opts.page.$(MIZRAHI_INVALID_SELECTOR))),
    ],
    changePassword: [/https:\/\/www\.mizrahi-tefahot\.co\.il\/login\/index\.html#\/change-pass/],
  },
};

export const UNION_CONFIG: LoginConfig = {
  loginUrl: 'https://hb.unionbank.co.il',
  fields: [
    { credentialKey: 'username', selectors: [{ kind: 'css', value: '#uid' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#password' }] },
  ],
  submit: [{ kind: 'css', value: '#enter' }],
  postAction: async (page: Page) => {
    await Promise.race([page.waitForSelector('#signoff'), page.waitForSelector('#restore')]);
  },
  possibleResults: {
    success: [/eBanking\/Accounts/],
    invalidPassword: [/InternalSite\/CustomUpdate\/leumi\/LoginPage.ASP/],
  },
};

export const MAX_CONFIG: LoginConfig = {
  loginUrl: 'https://www.max.co.il/login',
  fields: [
    { credentialKey: 'username', selectors: [{ kind: 'css', value: '#user-name' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#password' }] },
  ],
  submit: [{ kind: 'css', value: 'app-user-login-form .general-button.send-me-code' }],
  checkReadiness: async (page: Page) => {
    await waitUntilElementFound(page, '.personal-area > a.go-to-personal-area', { visible: true });
  },
  preAction: maxPreAction,
  postAction: maxPostAction,
  waitUntil: 'domcontentloaded',
  possibleResults: {
    success: ['https://www.max.co.il/homepage/personal'],
    changePassword: ['https://www.max.co.il/renew-password'],
    invalidPassword: [
      async opts => !!(opts?.page && (await elementPresentOnPage(opts.page, '#popupWrongDetails'))),
    ],
    unknownError: [
      async opts =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, '#popupCardHoldersLoginError'))),
    ],
  },
};

export const BEHATSDAA_CONFIG: LoginConfig = {
  loginUrl: 'https://www.behatsdaa.org.il/login',
  fields: [
    { credentialKey: 'id', selectors: [{ kind: 'css', value: '#loginId' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#loginPassword' }] },
  ],
  submit: [
    { kind: 'xpath', value: '//button[contains(., "התחברות")]' },
    { kind: 'ariaLabel', value: 'התחברות' },
  ],
  checkReadiness: async (page: Page) => {
    await Promise.all([
      waitUntilElementFound(page, '#loginId'),
      waitUntilElementFound(page, '#loginPassword'),
    ]);
  },
  possibleResults: {
    success: ['https://www.behatsdaa.org.il/'],
    invalidPassword: [
      async opts =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, '.custom-input-error-label'))),
    ],
  },
};

export const BEYAHAD_CONFIG: LoginConfig = {
  loginUrl: 'https://www.hist.org.il/login',
  fields: [
    { credentialKey: 'id', selectors: [{ kind: 'css', value: '#loginId' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#loginPassword' }] },
  ],
  submit: [
    { kind: 'xpath', value: '//button[contains(., "התחבר")]' },
    { kind: 'ariaLabel', value: 'התחבר' },
  ],
  possibleResults: { success: ['https://www.hist.org.il/'] },
};

export const YAHAV_CONFIG: LoginConfig = {
  loginUrl: 'https://login.yahav.co.il/login/',
  fields: [
    { credentialKey: 'username', selectors: [{ kind: 'css', value: '#username' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#password' }] },
    { credentialKey: 'nationalID', selectors: [{ kind: 'css', value: '#pinno' }] },
  ],
  submit: [{ kind: 'css', value: '.btn' }],
  checkReadiness: async (page: Page) => {
    await Promise.all([
      waitUntilElementFound(page, '#username'),
      waitUntilElementFound(page, '#password'),
      waitUntilElementFound(page, '#pinno'),
      waitUntilElementFound(page, '.btn'),
    ]);
  },
  postAction: yahavPostAction,
  possibleResults: {
    success: ['https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/main/home'],
    invalidPassword: [
      async opts => !!(opts?.page && (await elementPresentOnPage(opts.page, '.ui-dialog-buttons'))),
    ],
    changePassword: [
      async opts =>
        !!(
          opts?.page &&
          (await elementPresentOnPage(opts.page, 'input#ef_req_parameter_old_credential'))
        ),
    ],
  },
};
