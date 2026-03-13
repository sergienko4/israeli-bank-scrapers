import { CompanyTypes } from '../../../Definitions.js';
import {
  WELL_KNOWN_DASHBOARD_SELECTORS,
  WELL_KNOWN_LOGIN_SELECTORS,
} from '../WellKnownSelectors.js';
import {
  BEINLEUMI_DOM_SELECTORS,
  type IBankScraperConfig,
  NULL_API,
  NULL_AUTH,
  NULL_FORMAT,
  NULL_TIMING,
  SIMPLE_LOGIN,
  VISACAL_API,
} from './ScraperConfigDefaults.js';

export type { IBankScraperConfig };

/** Central per-bank scraper configuration — URLs, API, auth, format, timing, selectors. */
export const SCRAPER_CONFIGURATION = {
  banks: {
    [CompanyTypes.Hapoalim]: {
      urls: { base: 'https://www.bankhapoalim.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://login.bankhapoalim.co.il' },
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: {
        ...NULL_FORMAT,
        date: 'YYYYMMDD',
        apiLang: 'he',
        numItemsPerPage: 1000,
        sortCode: 1,
      },
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Leumi]: {
      urls: {
        base: 'https://www.leumi.co.il',
        loginRoute: null,
        transactions:
          'https://hb2.bankleumi.co.il/eBanking/SO/SPA.aspx#/ts/BusinessAccountTrx?WidgetPar=1',
      },
      api: { ...NULL_API, base: 'https://hb2.bankleumi.co.il' },
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD.MM.YY' },
      timing: NULL_TIMING,
      selectors: {
        advancedSearchBtn: [{ kind: 'ariaLabel', value: 'חיפוש מתקדם' }],
        dateRangeRadio: [{ kind: 'xpath', value: '//bll-radio-button[not(@checked)]' }],
        dateFromInput: [{ kind: 'name', value: 'txtInputFrom' }],
        filterBtn: [{ kind: 'ariaLabel', value: 'סנן' }],
        accountListItems: [
          {
            kind: 'xpath',
            value: '//app-masked-number-combo//span[contains(text(),"-")]',
          },
        ],
        accountCombo: [
          {
            kind: 'xpath',
            value: '//*[contains(@class, "number") and contains(@class, "combo-inner")]',
          },
        ],
      },
    },
    [CompanyTypes.Discount]: {
      urls: { base: 'https://www.discountbank.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://start.telebank.co.il' },
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'YYYYMMDD' },
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Mercantile]: {
      urls: { base: 'https://www.mercantile.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://start.telebank.co.il' },
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'YYYYMMDD' },
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Mizrahi]: {
      urls: {
        base: 'https://www.mizrahi-tefahot.co.il',
        loginRoute: 'https://www.mizrahi-tefahot.co.il/login/index.html#/auth-page-he',
        transactions: null,
      },
      api: { ...NULL_API, base: 'https://mto.mizrahi-tefahot.co.il' },
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY', maxRowsPerRequest: 10000000000 },
      timing: NULL_TIMING,
      selectors: {
        accountDropdown: [{ kind: 'ariaLabel', value: 'בחר חשבון' }],
        accountDropdownItem: [
          { kind: 'xpath', value: '//div[@id="AccountPicker"]//div[contains(text(),"-")]' },
        ],
        accountNumberSpan: [{ kind: 'xpath', value: '//button[@id="dropdownBasic"]//b//span' }],
        pendingTransactionRows: [
          { kind: 'xpath', value: '//tr[contains(@class,"rgRow") or contains(@class,"rgAltRow")]' },
        ],
        pendingFrameIdentifier: [{ kind: 'name', value: 'ctl00_ContentPlaceHolder2_panel1' }],
        oshLink: [{ kind: 'textContent', value: 'עו"ש' }],
        transactionsLink: [{ kind: 'textContent', value: 'תנועות' }],
        pendingTransactionsLink: [{ kind: 'textContent', value: 'תנועות עתידיות' }],
      },
    },
    [CompanyTypes.Max]: {
      urls: { base: 'https://www.max.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://onlinelcapi.max.co.il' },
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Amex]: {
      urls: { base: 'https://americanexpress.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://he.americanexpress.co.il' },
      auth: { ...NULL_AUTH, companyCode: '77', countryCode: '212', idType: '1', checkLevel: '1' },
      loginSetup: { ...SIMPLE_LOGIN, isApiOnly: true },
      format: NULL_FORMAT,
      timing: { ...NULL_TIMING, loginDelayMinMs: 1500, loginDelayMaxMs: 3000 },
      selectors: {},
    },
    [CompanyTypes.Isracard]: {
      urls: { base: 'https://www.isracard.co.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, base: 'https://digital.isracard.co.il' },
      auth: { ...NULL_AUTH, companyCode: '11', countryCode: '212', idType: '1', checkLevel: '1' },
      loginSetup: { ...SIMPLE_LOGIN, isApiOnly: true },
      format: NULL_FORMAT,
      timing: { ...NULL_TIMING, loginDelayMinMs: 1500, loginDelayMaxMs: 3000 },
      selectors: {},
    },
    [CompanyTypes.VisaCal]: {
      urls: { base: 'https://www.cal-online.co.il/', loginRoute: null, transactions: null },
      api: VISACAL_API,
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.Beinleumi]: {
      urls: {
        base: 'https://www.fibi.co.il',
        loginRoute: null,
        transactions:
          'https://online.fibi.co.il/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow',
      },
      api: NULL_API,
      auth: NULL_AUTH,
      loginSetup: { ...SIMPLE_LOGIN, hasOtpConfirm: true, hasOtpCode: true },
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_DOM_SELECTORS,
    },
    [CompanyTypes.OtsarHahayal]: {
      urls: {
        base: 'https://www.bankotsar.co.il',
        loginRoute: null,
        transactions:
          'https://online.bankotsar.co.il/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow',
      },
      api: NULL_API,
      auth: NULL_AUTH,
      loginSetup: { ...SIMPLE_LOGIN, hasOtpConfirm: true, hasOtpCode: true },
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_DOM_SELECTORS,
    },
    [CompanyTypes.Massad]: {
      urls: {
        base: 'https://www.bankmassad.co.il',
        loginRoute: null,
        transactions:
          'https://online.bankmassad.co.il/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow',
      },
      api: NULL_API,
      auth: NULL_AUTH,
      loginSetup: { ...SIMPLE_LOGIN, hasOtpConfirm: true, hasOtpCode: true },
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_DOM_SELECTORS,
    },
    [CompanyTypes.Pagi]: {
      urls: {
        base: 'https://www.pagi.co.il',
        loginRoute: null,
        transactions:
          'https://online.pagi.co.il/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow',
      },
      api: NULL_API,
      auth: NULL_AUTH,
      loginSetup: { ...SIMPLE_LOGIN, hasOtpConfirm: true, hasOtpCode: true },
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: { ...NULL_TIMING, elementRenderMs: 10000 },
      selectors: BEINLEUMI_DOM_SELECTORS,
    },
    [CompanyTypes.Behatsdaa]: {
      urls: { base: 'https://www.behatsdaa.org.il', loginRoute: null, transactions: null },
      api: {
        ...NULL_API,
        purchaseHistory: 'https://back.behatsdaa.org.il/api/purchases/purchaseHistory',
      },
      auth: { ...NULL_AUTH, organizationId: '20' },
      loginSetup: SIMPLE_LOGIN,
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
    [CompanyTypes.BeyahadBishvilha]: {
      urls: { base: 'https://www.hist.org.il', loginRoute: null, transactions: null },
      api: { ...NULL_API, card: 'https://www.hist.org.il/card/balanceAndUses' },
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD/MM/YY' },
      timing: NULL_TIMING,
      selectors: {
        transactionContainer: [
          {
            kind: 'xpath',
            value:
              '//div[contains(@class,"transaction-container") or contains(@class,"transaction-component")]',
          },
        ],
        transactionColumns: [
          { kind: 'xpath', value: '//div[contains(@class,"transaction-item")]/span' },
        ],
        cardNumber: [{ kind: 'ariaLabel', value: 'מספר כרטיס' }],
        balance: [{ kind: 'ariaLabel', value: 'יתרה' }],
        loadingIndicator: [
          { kind: 'xpath', value: '//*[@aria-busy="false" or @data-loading="false"]' },
        ],
      },
    },
    [CompanyTypes.Yahav]: {
      urls: { base: 'https://www.yahav.co.il', loginRoute: null, transactions: null },
      api: NULL_API,
      auth: NULL_AUTH,
      loginSetup: SIMPLE_LOGIN,
      format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
      timing: NULL_TIMING,
      selectors: {
        accountDetails: [{ kind: 'textContent', value: 'פרטי חשבון' }],
        accountId: [{ kind: 'ariaLabel', value: 'מספר תיק' }],
        transactionRows: [
          {
            kind: 'xpath',
            value: '//div[contains(@class,"list-item")]//div[contains(@class,"entire-content")]',
          },
        ],
        transactionTableHeader: [{ kind: 'textContent', value: 'תנועות' }],
        datePickerOpener: [{ kind: 'ariaLabel', value: 'בחר תאריך' }],
        monthPickerBtn: [{ kind: 'xpath', value: '//div[contains(@class,"pmu-month")]' }],
        loadingSpinner: [{ kind: 'xpath', value: '//*[@role="progressbar" or @aria-busy="true"]' }],
        monthsGridCheck: [{ kind: 'xpath', value: '//div[contains(@class,"pmu-months")]/div[1]' }],
        yearsGridCheck: [{ kind: 'xpath', value: '//div[contains(@class,"pmu-years")]/div[1]' }],
      },
    },
    [CompanyTypes.OneZero]: {
      urls: { base: 'https://www.onezero.co.il', loginRoute: null, transactions: null },
      api: NULL_API,
      auth: NULL_AUTH,
      loginSetup: { ...SIMPLE_LOGIN, hasOtpCode: true },
      format: NULL_FORMAT,
      timing: NULL_TIMING,
      selectors: {},
    },
  } satisfies Record<CompanyTypes, IBankScraperConfig>,

  wellKnownSelectors: WELL_KNOWN_LOGIN_SELECTORS,
  wellKnownDashboardSelectors: WELL_KNOWN_DASHBOARD_SELECTORS,
} as const;
