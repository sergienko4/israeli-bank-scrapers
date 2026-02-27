import { type Page } from 'playwright';
import { CompanyTypes } from '../definitions';
import {
  clickButton,
  elementPresentOnPage,
  pageEval,
  pageEvalAll,
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../helpers/elements-interactions';
import { waitForNavigation, waitForRedirect } from '../helpers/navigation';
import { sleep } from '../helpers/waiting';
import { type LoginConfig } from './login-config';

// ─── BeinleumiGroup shared helpers ───────────────────────────────────────────

async function beinleumiPostAction(page: Page) {
  await Promise.race([
    page.waitForSelector('#card-header'),
    page.waitForSelector('#account_num'),
    page.waitForSelector('#matafLogoutLink'),
    page.waitForSelector('#validationMsg'),
  ]);
}

function beinleumiConfig(loginUrl: string): LoginConfig {
  return {
    loginUrl,
    fields: [
      {
        credentialKey: 'username',
        selectors: [{ kind: 'css', value: '#username' }],
      },
      {
        credentialKey: 'password',
        selectors: [{ kind: 'css', value: '#password' }],
      },
    ],
    submit: [
      { kind: 'css', value: '#continueBtn' },
      { kind: 'ariaLabel', value: 'כניסה' },
    ],
    preAction: async () => {
      await sleep(1000);
      // returns void — preAction here is a simple delay, not a frame switch
    },
    postAction: beinleumiPostAction,
    possibleResults: {
      success: [/fibi.*accountSummary/, /Resources\/PortalNG\/shell/, /FibiMenu\/Online/],
      invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
    },
  };
}

// ─── Discount shared helpers ──────────────────────────────────────────────────

async function discountPostAction(page: Page) {
  try {
    await waitForNavigation(page);
  } catch {
    await page.waitForSelector('#general-error');
  }
}

const discountFields: LoginConfig['fields'] = [
  { credentialKey: 'id', selectors: [{ kind: 'css', value: '#tzId' }] },
  { credentialKey: 'password', selectors: [{ kind: 'css', value: '#tzPassword' }] },
  { credentialKey: 'num', selectors: [{ kind: 'css', value: '#aidnum' }] },
];

const discountPossibleResults: LoginConfig['possibleResults'] = {
  success: [
    'https://start.telebank.co.il/apollo/retail/#/MY_ACCOUNT_HOMEPAGE',
    'https://start.telebank.co.il/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE',
    'https://start.telebank.co.il/apollo/retail2/',
  ],
  invalidPassword: ['https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE'],
  changePassword: ['https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW'],
};

function discountConfig(loginUrl: string): LoginConfig {
  return {
    loginUrl,
    fields: discountFields,
    submit: [{ kind: 'css', value: '.sendBtn' }],
    checkReadiness: async (page: Page) => {
      await waitUntilElementFound(page, '#tzId');
    },
    postAction: discountPostAction,
    possibleResults: discountPossibleResults,
  };
}

// ─── Hapoalim helpers ─────────────────────────────────────────────────────────

const HAPOALIM_BASE = 'https://login.bankhapoalim.co.il';

// ─── Leumi helpers ────────────────────────────────────────────────────────────

const LEUMI_INVALID_PASSWORD_MSG = 'אחד או יותר מפרטי ההזדהות שמסרת שגויים. ניתן לנסות שוב';
const LEUMI_ACCOUNT_BLOCKED_MSG = 'המנוי חסום';

async function leumiCheckReadiness(page: Page) {
  await waitUntilElementFound(page, '.enter_account');
  const loginUrl = await pageEval(page, '.enter_account', null, el => (el as HTMLAnchorElement).href);
  await page.goto(loginUrl);
  await waitForNavigation(page, { waitUntil: 'networkidle' });
  await Promise.all([
    waitUntilElementFound(page, 'input[placeholder="שם משתמש"]', true),
    waitUntilElementFound(page, 'input[placeholder="סיסמה"]', true),
    waitUntilElementFound(page, 'button[type="submit"]', true),
  ]);
}

async function leumiPostAction(page: Page) {
  await Promise.race([
    waitUntilElementFound(page, 'a[title="דלג לחשבון"]', true, 60000),
    waitUntilElementFound(page, 'div.main-content', false, 60000),
    page.waitForSelector(`xpath=//div[contains(string(),"${LEUMI_INVALID_PASSWORD_MSG}")]`),
    waitUntilElementFound(page, 'form[action="/changepassword"]', true, 60000),
  ]);
}

// ─── Mizrahi helpers ──────────────────────────────────────────────────────────

const MIZRAHI_CHECKING_ACCOUNT_HE = 'עובר ושב';
const MIZRAHI_CHECKING_ACCOUNT_EN = 'Checking Account';
const MIZRAHI_INVALID_SELECTOR = 'a[href*="https://sc.mizrahi-tefahot.co.il/SCServices/SC/P010.aspx"]';

async function mizrahiIsLoggedIn(opts?: { page?: Page }) {
  if (!opts?.page) return false;
  const xpath = `//a//span[contains(., "${MIZRAHI_CHECKING_ACCOUNT_HE}") or contains(., "${MIZRAHI_CHECKING_ACCOUNT_EN}")]`;
  return (await opts.page.$$(`xpath=${xpath}`)).length > 0;
}

async function mizrahiPostAction(page: Page) {
  await Promise.race([
    waitUntilElementFound(page, '#dropdownBasic'),
    waitUntilElementFound(page, MIZRAHI_INVALID_SELECTOR),
    page.waitForURL(/https:\/\/www\.mizrahi-tefahot\.co\.il\/login\/index\.html#\/change-pass/),
  ]);
}

// ─── Max helpers ──────────────────────────────────────────────────────────────

async function maxPreActionStep1(page: Page) {
  if (await elementPresentOnPage(page, '#closePopup')) await clickButton(page, '#closePopup');
  await clickButton(page, '.personal-area > a.go-to-personal-area');
}

async function maxPreActionStep2(page: Page) {
  if (await elementPresentOnPage(page, '.login-link#private')) await clickButton(page, '.login-link#private');
  await waitUntilElementFound(page, '#login-password-link', true);
  await clickButton(page, '#login-password-link');
  await waitUntilElementFound(page, '#login-password.tab-pane.active app-user-login-form', true);
}

async function maxPreAction(page: Page) {
  await maxPreActionStep1(page);
  await maxPreActionStep2(page);
}

async function maxPostAction(page: Page) {
  await Promise.race([
    waitForRedirect(page, 20000, false, ['https://www.max.co.il', 'https://www.max.co.il/']),
    waitUntilElementFound(page, '#popupWrongDetails', true),
    waitUntilElementFound(page, '#popupCardHoldersLoginError', true),
  ]);
}

// ─── Yahav helpers ────────────────────────────────────────────────────────────

async function yahavPostAction(page: Page) {
  await waitForRedirect(page);
  await waitUntilElementDisappear(page, '.loader');
  if (await elementPresentOnPage(page, '.messaging-links-container')) {
    await clickButton(page, '.link-1');
  }
  await Promise.race([
    waitUntilElementFound(page, '#AccountDetails'),
    waitUntilElementFound(page, 'input#ef_req_parameter_old_credential'),
  ]);
}

// ─── THE BANK REGISTRY ────────────────────────────────────────────────────────

export const BANK_REGISTRY: Partial<Record<CompanyTypes, LoginConfig>> = {
  // ── BeinleumiGroup × 4 ───────────────────────────────────────────────────
  [CompanyTypes.beinleumi]: beinleumiConfig(
    'https://online.fibi.co.il/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private&KODSAFA=HE',
  ),
  [CompanyTypes.otsarHahayal]: beinleumiConfig(
    'https://online.bankotsar.co.il/MatafLoginService/MatafLoginServlet?bankId=OTSARPRTAL&site=Private&KODSAFA=HE',
  ),
  [CompanyTypes.massad]: beinleumiConfig(
    'https://online.bankmassad.co.il/MatafLoginService/MatafLoginServlet?bankId=MASADPRTAL&site=Private&KODSAFA=HE',
  ),
  [CompanyTypes.pagi]: beinleumiConfig(
    'https://online.pagi.co.il/MatafLoginService/MatafLoginServlet?bankId=PAGIPORTAL&site=Private&KODSAFA=HE',
  ),

  // ── Discount / Mercantile ─────────────────────────────────────────────────
  [CompanyTypes.discount]: discountConfig('https://start.telebank.co.il/login/#/LOGIN_PAGE'),
  [CompanyTypes.mercantile]: discountConfig('https://start.telebank.co.il/login/?bank=m'),

  // ── Hapoalim ─────────────────────────────────────────────────────────────
  [CompanyTypes.hapoalim]: {
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
      await waitForRedirect(page);
    },
    possibleResults: {
      success: [
        `${HAPOALIM_BASE}/portalserver/HomePage`,
        `${HAPOALIM_BASE}/ng-portals-bt/rb/he/homepage`,
        `${HAPOALIM_BASE}/ng-portals/rb/he/homepage`,
      ],
      invalidPassword: [`${HAPOALIM_BASE}/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false`],
      changePassword: [`${HAPOALIM_BASE}/MCP/START?flow=MCP&state=START&expiredDate=null`, /\/ABOUTTOEXPIRE\/START/i],
    },
  },

  // ── Leumi ─────────────────────────────────────────────────────────────────
  [CompanyTypes.leumi]: {
    loginUrl: 'https://www.leumi.co.il/he',
    fields: [
      {
        credentialKey: 'username',
        selectors: [{ kind: 'placeholder', value: 'שם משתמש' }],
      },
      {
        credentialKey: 'password',
        selectors: [{ kind: 'placeholder', value: 'סיסמה' }],
      },
    ],
    submit: [{ kind: 'css', value: "button[type='submit']" }],
    checkReadiness: leumiCheckReadiness,
    postAction: leumiPostAction,
    possibleResults: {
      success: [/ebanking\/SO\/SPA.aspx/i],
      invalidPassword: [
        async opts => {
          if (!opts?.page) return false;
          const msg = await pageEvalAll(
            opts.page,
            'svg#Capa_1',
            '',
            el => (el[0]?.parentElement?.children[1] as HTMLDivElement)?.innerText,
          );
          return msg?.startsWith(LEUMI_INVALID_PASSWORD_MSG) ?? false;
        },
      ],
      accountBlocked: [
        async opts => {
          if (!opts?.page) return false;
          const msg = await pageEvalAll(opts.page, '.errHeader', '', el => (el[0] as HTMLElement)?.innerText);
          return msg?.startsWith(LEUMI_ACCOUNT_BLOCKED_MSG) ?? false;
        },
      ],
      changePassword: ['https://hb2.bankleumi.co.il/authenticate'],
    },
  },

  // ── Mizrahi ───────────────────────────────────────────────────────────────
  [CompanyTypes.mizrahi]: {
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
      invalidPassword: [async opts => !!(opts?.page && (await opts.page.$(MIZRAHI_INVALID_SELECTOR)))],
      changePassword: [/https:\/\/www\.mizrahi-tefahot\.co\.il\/login\/index\.html#\/change-pass/],
    },
  },

  // ── Union Bank ────────────────────────────────────────────────────────────
  [CompanyTypes.union]: {
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
  },

  // ── Max ───────────────────────────────────────────────────────────────────
  [CompanyTypes.max]: {
    loginUrl: 'https://www.max.co.il/login',
    fields: [
      { credentialKey: 'username', selectors: [{ kind: 'css', value: '#user-name' }] },
      { credentialKey: 'password', selectors: [{ kind: 'css', value: '#password' }] },
    ],
    submit: [{ kind: 'css', value: 'app-user-login-form .general-button.send-me-code' }],
    checkReadiness: async (page: Page) => {
      await waitUntilElementFound(page, '.personal-area > a.go-to-personal-area', true);
    },
    preAction: maxPreAction,
    postAction: maxPostAction,
    waitUntil: 'domcontentloaded',
    possibleResults: {
      success: ['https://www.max.co.il/homepage/personal'],
      changePassword: ['https://www.max.co.il/renew-password'],
      invalidPassword: [async opts => !!(opts?.page && (await elementPresentOnPage(opts.page, '#popupWrongDetails')))],
      unknownError: [
        async opts => !!(opts?.page && (await elementPresentOnPage(opts.page, '#popupCardHoldersLoginError'))),
      ],
    },
  },

  // ── Behatsdaa ─────────────────────────────────────────────────────────────
  [CompanyTypes.behatsdaa]: {
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
      await Promise.all([waitUntilElementFound(page, '#loginId'), waitUntilElementFound(page, '#loginPassword')]);
    },
    possibleResults: {
      success: ['https://www.behatsdaa.org.il/'],
      invalidPassword: [
        async opts => !!(opts?.page && (await elementPresentOnPage(opts.page, '.custom-input-error-label'))),
      ],
    },
  },

  // ── Beyahad Bishvilha ─────────────────────────────────────────────────────
  [CompanyTypes.beyahadBishvilha]: {
    loginUrl: 'https://www.hist.org.il/login',
    fields: [
      { credentialKey: 'id', selectors: [{ kind: 'css', value: '#loginId' }] },
      { credentialKey: 'password', selectors: [{ kind: 'css', value: '#loginPassword' }] },
    ],
    submit: [
      { kind: 'xpath', value: '//button[contains(., "התחבר")]' },
      { kind: 'ariaLabel', value: 'התחבר' },
    ],
    possibleResults: {
      success: ['https://www.hist.org.il/'],
    },
  },

  // ── Yahav ─────────────────────────────────────────────────────────────────
  [CompanyTypes.yahav]: {
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
      invalidPassword: [async opts => !!(opts?.page && (await elementPresentOnPage(opts.page, '.ui-dialog-buttons')))],
      changePassword: [
        async opts =>
          !!(opts?.page && (await elementPresentOnPage(opts.page, 'input#ef_req_parameter_old_credential'))),
      ],
    },
  },
};
