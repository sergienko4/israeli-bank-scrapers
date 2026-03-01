import { type Page } from 'playwright';
import { CompanyTypes } from '../Definitions';
import { elementPresentOnPage, waitUntilElementFound } from '../Helpers/ElementsInteractions';
import { waitForNavigation } from '../Helpers/Navigation';
import { sleep } from '../Helpers/Waiting';
import { type LoginConfig } from './LoginConfig';
import {
  HAPOALIM_CONFIG,
  LEUMI_CONFIG,
  MIZRAHI_CONFIG,
  UNION_CONFIG,
  MAX_CONFIG,
  BEHATSDAA_CONFIG,
  BEYAHAD_CONFIG,
  YAHAV_CONFIG,
} from './BankRegistryExtra';

async function beinleumiPostAction(page: Page): Promise<void> {
  await Promise.race([
    page.waitForSelector('#card-header'),
    page.waitForSelector('#account_num'),
    page.waitForSelector('#matafLogoutLink'),
    page.waitForSelector('#validationMsg'),
    page.waitForSelector('[class*="account-summary"]', { timeout: 30000 }),
  ]).catch(() => {});
}

const BEINLEUMI_FIELDS: LoginConfig['fields'] = [
  { credentialKey: 'username', selectors: [{ kind: 'css', value: '#username' }] },
  { credentialKey: 'password', selectors: [{ kind: 'css', value: '#password' }] },
];

const BEINLEUMI_SUBMIT: LoginConfig['submit'] = [
  { kind: 'css', value: '#continueBtn' },
  { kind: 'ariaLabel', value: 'כניסה' },
];

const BEINLEUMI_POSSIBLE_RESULTS: LoginConfig['possibleResults'] = {
  success: [/fibi.*accountSummary/, /Resources\/PortalNG\/shell/, /FibiMenu\/Online/],
  invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
};

async function beinleumiPreAction(page: Page): Promise<void> {
  const hasTrigger = await elementPresentOnPage(page, 'a.login-trigger');
  if (hasTrigger) {
    await page.evaluate(() => {
      const el = document.querySelector('a.login-trigger');
      if (el instanceof HTMLElement) el.click();
    });
    await sleep(2000);
  } else {
    await sleep(1000);
  }
}

function beinleumiConfig(loginUrl: string): LoginConfig {
  return {
    loginUrl,
    fields: BEINLEUMI_FIELDS,
    submit: BEINLEUMI_SUBMIT,
    preAction: beinleumiPreAction,
    postAction: beinleumiPostAction,
    possibleResults: BEINLEUMI_POSSIBLE_RESULTS,
  };
}

async function discountPostAction(page: Page): Promise<void> {
  try {
    await waitForNavigation(page);
  } catch {
    await waitUntilElementFound(page, '#general-error', { visible: false, timeout: 100 });
  }
}

const DISCOUNT_FIELDS: LoginConfig['fields'] = [
  { credentialKey: 'id', selectors: [{ kind: 'css', value: '#tzId' }] },
  { credentialKey: 'password', selectors: [{ kind: 'css', value: '#tzPassword' }] },
  { credentialKey: 'num', selectors: [{ kind: 'css', value: '#aidnum' }] },
];

const DISCOUNT_POSSIBLE_RESULTS: LoginConfig['possibleResults'] = {
  success: [
    'https://start.telebank.co.il/apollo/retail/#/MY_ACCOUNT_HOMEPAGE',
    'https://start.telebank.co.il/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE',
    'https://start.telebank.co.il/apollo/retail2/',
  ],
  invalidPassword: [
    'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE',
  ],
  changePassword: [
    'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW',
  ],
};

function discountConfig(loginUrl: string): LoginConfig {
  return {
    loginUrl,
    fields: DISCOUNT_FIELDS,
    submit: [{ kind: 'css', value: '.sendBtn' }],
    checkReadiness: async (page: Page) => {
      await waitUntilElementFound(page, '#tzId');
    },
    postAction: discountPostAction,
    possibleResults: DISCOUNT_POSSIBLE_RESULTS,
  };
}

export const BANK_REGISTRY: Partial<Record<CompanyTypes, LoginConfig>> = {
  [CompanyTypes.Beinleumi]: beinleumiConfig('https://www.fibi.co.il/private'),
  [CompanyTypes.OtsarHahayal]: beinleumiConfig(
    'https://online.bankotsar.co.il/MatafLoginService/MatafLoginServlet?bankId=OTSARPRTAL&site=Private&KODSAFA=HE',
  ),
  [CompanyTypes.Massad]: beinleumiConfig(
    'https://online.bankmassad.co.il/MatafLoginService/MatafLoginServlet?bankId=MASADPRTAL&site=Private&KODSAFA=HE',
  ),
  [CompanyTypes.Pagi]: beinleumiConfig(
    'https://online.pagi.co.il/MatafLoginService/MatafLoginServlet?bankId=PAGIPORTAL&site=Private&KODSAFA=HE',
  ),
  [CompanyTypes.Discount]: discountConfig('https://start.telebank.co.il/login/#/LOGIN_PAGE'),
  [CompanyTypes.Mercantile]: discountConfig('https://start.telebank.co.il/login/?bank=m'),
  [CompanyTypes.Hapoalim]: HAPOALIM_CONFIG,
  [CompanyTypes.Leumi]: LEUMI_CONFIG,
  [CompanyTypes.Mizrahi]: MIZRAHI_CONFIG,
  [CompanyTypes.Union]: UNION_CONFIG,
  [CompanyTypes.Max]: MAX_CONFIG,
  [CompanyTypes.Behatsdaa]: BEHATSDAA_CONFIG,
  [CompanyTypes.BeyahadBishvilha]: BEYAHAD_CONFIG,
  [CompanyTypes.Yahav]: YAHAV_CONFIG,
};
