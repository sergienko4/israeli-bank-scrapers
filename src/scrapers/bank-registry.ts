import { type Page } from 'playwright';
import { CompanyTypes } from '../definitions';
import { elementPresentOnPage, waitUntilElementFound } from '../helpers/elements-interactions';
import { waitForNavigation } from '../helpers/navigation';
import { sleep } from '../helpers/waiting';
import { type LoginConfig } from './login-config';
import {
  HAPOALIM_CONFIG,
  LEUMI_CONFIG,
  MIZRAHI_CONFIG,
  UNION_CONFIG,
  MAX_CONFIG,
  BEHATSDAA_CONFIG,
  BEYAHAD_CONFIG,
  YAHAV_CONFIG,
} from './bank-registry-extra';

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

export const BANK_REGISTRY: Partial<Record<CompanyTypes, LoginConfig>> = {
  [CompanyTypes.beinleumi]: beinleumiConfig('https://www.fibi.co.il/private'),
  [CompanyTypes.otsarHahayal]: beinleumiConfig(
    'https://online.bankotsar.co.il/MatafLoginService/MatafLoginServlet?bankId=OTSARPRTAL&site=Private&KODSAFA=HE',
  ),
  [CompanyTypes.massad]: beinleumiConfig(
    'https://online.bankmassad.co.il/MatafLoginService/MatafLoginServlet?bankId=MASADPRTAL&site=Private&KODSAFA=HE',
  ),
  [CompanyTypes.pagi]: beinleumiConfig(
    'https://online.pagi.co.il/MatafLoginService/MatafLoginServlet?bankId=PAGIPORTAL&site=Private&KODSAFA=HE',
  ),
  [CompanyTypes.discount]: discountConfig('https://start.telebank.co.il/login/#/LOGIN_PAGE'),
  [CompanyTypes.mercantile]: discountConfig('https://start.telebank.co.il/login/?bank=m'),
  [CompanyTypes.hapoalim]: HAPOALIM_CONFIG,
  [CompanyTypes.leumi]: LEUMI_CONFIG,
  [CompanyTypes.mizrahi]: MIZRAHI_CONFIG,
  [CompanyTypes.union]: UNION_CONFIG,
  [CompanyTypes.max]: MAX_CONFIG,
  [CompanyTypes.behatsdaa]: BEHATSDAA_CONFIG,
  [CompanyTypes.beyahadBishvilha]: BEYAHAD_CONFIG,
  [CompanyTypes.yahav]: YAHAV_CONFIG,
};
