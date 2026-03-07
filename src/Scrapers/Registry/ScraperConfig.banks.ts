import { CompanyTypes } from '../../Definitions';
import { type SelectorCandidate } from '../Base/LoginConfig';
import {
  type IBankScraperConfig,
  NULL_API,
  NULL_AUTH,
  NULL_FORMAT,
  NULL_TIMING,
} from './ScraperConfig.types';

// ─── Shared selector sets ─────────────────────────────────────────────────────

// Column class strings (used for td class matching in BaseBeinleumiGroupHelpers) are
// intentionally NOT here — they are hardcoded in BaseBeinleumiGroupHelpers.ts.
export const BEINLEUMI_DOM_SELECTORS: Record<string, SelectorCandidate[]> = {
  accountsNumber: [{ kind: 'css', value: 'div.fibi_account span.acc_num' }],
  completedTransactionsTable: [{ kind: 'css', value: 'table#dataTable077' }],
  pendingTransactionsTable: [{ kind: 'css', value: 'table#dataTable023' }],
  nextPageLink: [{ kind: 'css', value: 'a#Npage.paging' }],
  currentBalance: [{ kind: 'css', value: '.main_balance' }],
  transactionsTab: [{ kind: 'css', value: 'a#tabHeader4' }],
  datesContainer: [{ kind: 'css', value: 'div#fibi_dates' }],
  fromDateInput: [{ kind: 'css', value: 'input#fromDate' }],
  showButton: [{ kind: 'css', value: 'input[value=הצג]' }],
  tableContainer: [{ kind: 'css', value: "div[id*='divTable']" }],
  closeDatePickerBtn: [{ kind: 'css', value: 'button.ui-datepicker-close' }],
};

export const VISACAL_API: IBankScraperConfig['api'] = {
  base: null,
  purchaseHistory: null,
  card: null,
  calTransactions:
    'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails',
  calFrames: 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus',
  calPending: 'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests',
  calInit: 'https://api.cal-online.co.il/Authentication/api/account/init',
  calLoginResponse: '/col-rest/calconnect/authentication/login',
  calOrigin: 'https://digital-web.cal-online.co.il',
  calXSiteId: '09031987-273E-2311-906C-8AF85B17C8D9',
};

// ─── Bank configurations ──────────────────────────────────────────────────────

export const BANKS = {
  [CompanyTypes.Hapoalim]: {
    urls: { base: 'https://www.bankhapoalim.co.il', loginRoute: null, transactions: null },
    api: { ...NULL_API, base: 'https://login.bankhapoalim.co.il' },
    auth: NULL_AUTH,
    format: {
      ...NULL_FORMAT,
      date: 'YYYYMMDD',
      apiLang: 'he',
      numItemsPerPage: 1000,
      sortCode: 1,
    },
    timing: NULL_TIMING,
    selectors: {},
    wrongCredentialTexts: [],
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
    format: { ...NULL_FORMAT, date: 'DD.MM.YY' },
    timing: NULL_TIMING,
    selectors: {
      advancedSearchBtn: [{ kind: 'css', value: 'button[title="חיפוש מתקדם"]' }],
      dateRangeRadio: [{ kind: 'css', value: 'bll-radio-button:not([checked])' }],
      dateFromInput: [{ kind: 'css', value: 'input[formcontrolname="txtInputFrom"]' }],
      filterBtn: [{ kind: 'ariaLabel', value: 'סנן' }],
      accountListItems: [{ kind: 'css', value: 'app-masked-number-combo span.display-number-li' }],
      accountCombo: [
        {
          kind: 'xpath',
          value: '//*[contains(@class, "number") and contains(@class, "combo-inner")]',
        },
      ],
    },
    wrongCredentialTexts: [],
  },
  [CompanyTypes.Discount]: {
    urls: {
      base: 'https://www.discountbank.co.il',
      loginRoute: 'https://start.telebank.co.il',
      transactions: null,
    },
    api: { ...NULL_API, base: 'https://start.telebank.co.il' },
    auth: NULL_AUTH,
    format: { ...NULL_FORMAT, date: 'YYYYMMDD' },
    timing: NULL_TIMING,
    selectors: {},
    wrongCredentialTexts: ['פרטים שהזנת שגויים', 'תהליך הזיהוי נכשל'],
  },
  [CompanyTypes.Mercantile]: {
    urls: {
      base: 'https://www.mercantile.co.il',
      loginRoute: 'https://start.telebank.co.il',
      transactions: null,
    },
    api: { ...NULL_API, base: 'https://start.telebank.co.il' },
    auth: NULL_AUTH,
    format: { ...NULL_FORMAT, date: 'YYYYMMDD' },
    timing: NULL_TIMING,
    selectors: {},
    wrongCredentialTexts: ['פרטים שהזנת שגויים', 'תהליך הזיהוי נכשל'],
  },
  [CompanyTypes.Mizrahi]: {
    urls: {
      base: 'https://www.mizrahi-tefahot.co.il',
      loginRoute: 'https://www.mizrahi-tefahot.co.il/login/index.html#/auth-page-he',
      transactions: null,
    },
    api: { ...NULL_API, base: 'https://mto.mizrahi-tefahot.co.il' },
    auth: NULL_AUTH,
    format: { ...NULL_FORMAT, date: 'DD/MM/YYYY', maxRowsPerRequest: 10000000000 },
    timing: NULL_TIMING,
    selectors: {
      accountDropdown: [{ kind: 'css', value: '#dropdownBasic, .item' }],
      accountDropdownItem: [{ kind: 'css', value: '#AccountPicker .item' }],
      accountNumberSpan: [{ kind: 'css', value: '#dropdownBasic b span' }],
      pendingTransactionRows: [{ kind: 'css', value: 'tr.rgRow, tr.rgAltRow' }],
      pendingFrameIdentifier: [{ kind: 'css', value: '#ctl00_ContentPlaceHolder2_panel1' }],
      oshLink: [{ kind: 'css', value: 'a[href*="/osh/legacy/legacy-Osh-Main"]' }],
      transactionsLink: [{ kind: 'css', value: 'a[href*="/osh/legacy/root-main-osh-p428New"]' }],
      pendingTransactionsLink: [{ kind: 'css', value: 'a[href*="/osh/legacy/legacy-Osh-p420"]' }],
    },
    wrongCredentialTexts: [],
  },
  [CompanyTypes.Max]: {
    urls: { base: 'https://www.max.co.il', loginRoute: null, transactions: null },
    api: { ...NULL_API, base: 'https://onlinelcapi.max.co.il' },
    auth: NULL_AUTH,
    format: NULL_FORMAT,
    timing: NULL_TIMING,
    selectors: {},
    wrongCredentialTexts: [], // 'שכחת את הפרטים' is a permanent link — not a reliable error signal
    wafReturnUrls: ['login?ReturnURL='], // WAF redirects back to login with a ReturnURL param
  },
  [CompanyTypes.Amex]: {
    urls: { base: 'https://americanexpress.co.il', loginRoute: null, transactions: null },
    api: { ...NULL_API, base: 'https://he.americanexpress.co.il' },
    auth: { ...NULL_AUTH, companyCode: '77', countryCode: '212', idType: '1', checkLevel: '1' },
    format: NULL_FORMAT,
    timing: { ...NULL_TIMING, loginDelayMinMs: 1500, loginDelayMaxMs: 3000 },
    selectors: {},
    wrongCredentialTexts: ['הנתונים לא תואמים'],
  },
  [CompanyTypes.Isracard]: {
    urls: { base: 'https://www.isracard.co.il', loginRoute: null, transactions: null },
    api: { ...NULL_API, base: 'https://digital.isracard.co.il' },
    auth: { ...NULL_AUTH, companyCode: '11', countryCode: '212', idType: '1', checkLevel: '1' },
    format: NULL_FORMAT,
    timing: { ...NULL_TIMING, loginDelayMinMs: 1500, loginDelayMaxMs: 3000 },
    selectors: {},
    wrongCredentialTexts: ['הנתונים לא תואמים'],
  },
  [CompanyTypes.VisaCal]: {
    urls: { base: 'https://www.cal-online.co.il/', loginRoute: null, transactions: null },
    api: VISACAL_API,
    auth: NULL_AUTH,
    format: NULL_FORMAT,
    timing: NULL_TIMING,
    selectors: {},
    wrongCredentialTexts: ['שם המשתמש או הסיסמה שהוזנו שגויים'],
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
    format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
    timing: { ...NULL_TIMING, elementRenderMs: 10000 },
    selectors: BEINLEUMI_DOM_SELECTORS,
    wrongCredentialTexts: ['אחד הנתונים הוקש שגוי'],
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
    format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
    timing: { ...NULL_TIMING, elementRenderMs: 10000 },
    selectors: BEINLEUMI_DOM_SELECTORS,
    wrongCredentialTexts: [],
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
    format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
    timing: { ...NULL_TIMING, elementRenderMs: 10000 },
    selectors: BEINLEUMI_DOM_SELECTORS,
    wrongCredentialTexts: [],
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
    format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
    timing: { ...NULL_TIMING, elementRenderMs: 10000 },
    selectors: BEINLEUMI_DOM_SELECTORS,
    wrongCredentialTexts: [],
  },
  [CompanyTypes.Behatsdaa]: {
    urls: { base: 'https://www.behatsdaa.org.il', loginRoute: null, transactions: null },
    api: {
      ...NULL_API,
      purchaseHistory: 'https://back.behatsdaa.org.il/api/purchases/purchaseHistory',
    },
    auth: { ...NULL_AUTH, organizationId: '20' },
    format: NULL_FORMAT,
    timing: NULL_TIMING,
    selectors: {},
    wrongCredentialTexts: [],
  },
  [CompanyTypes.BeyahadBishvilha]: {
    urls: { base: 'https://www.hist.org.il', loginRoute: null, transactions: null },
    api: { ...NULL_API, card: 'https://www.hist.org.il/card/balanceAndUses' },
    auth: NULL_AUTH,
    format: { ...NULL_FORMAT, date: 'DD/MM/YY' },
    timing: NULL_TIMING,
    selectors: {
      transactionContainer: [
        { kind: 'css', value: '.transaction-container, .transaction-component-container' },
      ],
      transactionColumns: [{ kind: 'css', value: '.transaction-item > span' }],
      cardNumber: [{ kind: 'css', value: '.wallet-details div:nth-of-type(2)' }],
      balance: [{ kind: 'css', value: '.wallet-details div:nth-of-type(4) > span:nth-of-type(2)' }],
      loadingIndicator: [{ kind: 'css', value: '.react-loading.hide' }],
    },
    wrongCredentialTexts: [],
  },
  [CompanyTypes.Yahav]: {
    urls: { base: 'https://www.yahav.co.il', loginRoute: null, transactions: null },
    api: NULL_API,
    auth: NULL_AUTH,
    format: { ...NULL_FORMAT, date: 'DD/MM/YYYY' },
    timing: NULL_TIMING,
    selectors: {
      accountDetails: [{ kind: 'css', value: '.account-details' }],
      accountId: [
        {
          kind: 'css',
          value: 'span.portfolio-value[ng-if="mainController.data.portfolioList.length === 1"]',
        },
      ],
      transactionRows: [{ kind: 'css', value: '.list-item-holder .entire-content-ctr' }],
      transactionTableHeader: [{ kind: 'css', value: '.under-line-txn-table-header' }],
      datePickerOpener: [
        {
          kind: 'css',
          value:
            'div.date-options-cell:nth-child(7) > date-picker:nth-child(1) > div:nth-child(1) > span:nth-child(2)',
        },
      ],
      monthPickerBtn: [{ kind: 'css', value: '.pmu-month' }],
      loadingSpinner: [{ kind: 'css', value: '.loading-bar-spinner' }],
      monthsGridCheck: [{ kind: 'css', value: '.pmu-months > div:nth-child(1)' }],
      yearsGridCheck: [{ kind: 'css', value: '.pmu-years > div:nth-child(1)' }],
      // Date-picker grid cell base selectors — used with :nth-child(i) for dynamic navigation
      pmuDaysFirstCell: [{ kind: 'css', value: '.pmu-days > div:nth-child(1)' }],
      pmuDaysCell: [{ kind: 'css', value: '.pmu-days > div' }],
      pmuYearsCell: [{ kind: 'css', value: '.pmu-years > div' }],
      pmuMonthsCell: [{ kind: 'css', value: '.pmu-months > div' }],
      statementOptionsTop: [{ kind: 'css', value: '.statement-options .selected-item-top' }],
    },
    wrongCredentialTexts: [],
  },
  [CompanyTypes.OneZero]: {
    urls: { base: 'https://www.onezero.co.il', loginRoute: null, transactions: null },
    api: NULL_API,
    auth: NULL_AUTH,
    format: NULL_FORMAT,
    timing: NULL_TIMING,
    selectors: {},
    wrongCredentialTexts: [],
  },
} satisfies Record<CompanyTypes, IBankScraperConfig>;
