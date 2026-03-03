import { type Frame, type Page } from 'playwright';

import { elementPresentOnPage, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { waitForNavigation } from '../../Common/Navigation';
import { sleep } from '../../Common/Waiting';
import { CompanyTypes } from '../../Definitions';
import { type LoginConfig } from '../Base/LoginConfig';
import {
  BEHATSDAA_CONFIG,
  BEYAHAD_CONFIG,
  HAPOALIM_CONFIG,
  LEUMI_CONFIG,
  MAX_CONFIG,
  MIZRAHI_CONFIG,
  YAHAV_CONFIG,
} from './BankRegistryExtra';

async function beinleumiPostAction(page: Page): Promise<void> {
  await Promise.race([
    page.waitForSelector('#card-header'),
    page.waitForSelector('#account_num'),
    page.waitForSelector('#matafLogoutLink'),
    page.waitForSelector('#validationMsg'),
    page.waitForSelector('[class*="account-summary"]', { timeout: 30000 }),
  ]).catch(() => {
    // intentionally ignore timeout — any matched selector is sufficient
  });
}

const BEINLEUMI_FIELDS: LoginConfig['fields'] = [
  { credentialKey: 'username', selectors: [] }, // wellKnown → #username
  { credentialKey: 'password', selectors: [] }, // wellKnown → #password
];

const BEINLEUMI_SUBMIT: LoginConfig['submit'] = [
  { kind: 'css', value: '#continueBtn' },
  // ariaLabel 'כניסה' fallback is now in wellKnownSelectors.__submit__
];

const BEINLEUMI_POSSIBLE_RESULTS: LoginConfig['possibleResults'] = {
  success: [/fibi.*accountSummary/, /Resources\/PortalNG\/shell/, /FibiMenu\/Online/],
  invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
};

async function beinleumiPreAction(page: Page): Promise<Frame | undefined> {
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
  return undefined;
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
  { credentialKey: 'id', selectors: [] }, // wellKnown → #tzId
  { credentialKey: 'password', selectors: [] }, // wellKnown → #tzPassword
  { credentialKey: 'num', selectors: [] }, // wellKnown → #aidnum
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
    checkReadiness: async (page: Page): Promise<void> => {
      await waitUntilElementFound(page, '#tzId');
    },
    postAction: discountPostAction,
    possibleResults: DISCOUNT_POSSIBLE_RESULTS,
  };
}

export const BANK_REGISTRY: Partial<Record<CompanyTypes, LoginConfig>> = {
  [CompanyTypes.Beinleumi]: beinleumiConfig('https://www.fibi.co.il'),
  [CompanyTypes.OtsarHahayal]: beinleumiConfig('https://www.bankotsar.co.il'),
  [CompanyTypes.Massad]: beinleumiConfig('https://www.bankmassad.co.il'),
  [CompanyTypes.Pagi]: beinleumiConfig('https://www.pagi.co.il'),
  [CompanyTypes.Discount]: discountConfig('https://www.discountbank.co.il'),
  [CompanyTypes.Mercantile]: discountConfig('https://www.mercantile.co.il'),
  [CompanyTypes.Hapoalim]: HAPOALIM_CONFIG,
  [CompanyTypes.Leumi]: LEUMI_CONFIG,
  [CompanyTypes.Mizrahi]: MIZRAHI_CONFIG,
  [CompanyTypes.Max]: MAX_CONFIG,
  [CompanyTypes.Behatsdaa]: BEHATSDAA_CONFIG,
  [CompanyTypes.BeyahadBishvilha]: BEYAHAD_CONFIG,
  [CompanyTypes.Yahav]: YAHAV_CONFIG,
};
