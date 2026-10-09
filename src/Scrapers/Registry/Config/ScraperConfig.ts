import { CompanyTypes } from '../../../Definitions.js';
import {
  WELL_KNOWN_DASHBOARD_SELECTORS,
  WELL_KNOWN_LOGIN_SELECTORS,
} from '../WellKnownSelectors.js';
import {
  type IBankScraperConfig,
  NULL_API,
  NULL_AUTH,
  NULL_FORMAT,
  NULL_TIMING,
  SIMPLE_LOGIN,
} from './ScraperConfigDefaults.js';

export type { IBankScraperConfig } from './ScraperConfigDefaults.js';

/** Central per-bank scraper configuration — URLs, API, auth, format, timing, selectors. */
export const SCRAPER_CONFIGURATION = {
  banks: {
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
          { kind: 'css', value: '.transaction-container, .transaction-component-container' },
        ],
        transactionColumns: [{ kind: 'css', value: '.transaction-item > span' }],
        cardNumber: [{ kind: 'css', value: '.wallet-details div:nth-of-type(2)' }],
        balance: [
          { kind: 'css', value: '.wallet-details div:nth-of-type(4) > span:nth-of-type(2)' },
        ],
        loadingIndicator: [{ kind: 'css', value: '.react-loading.hide' }],
      },
    },
  } satisfies Partial<Record<CompanyTypes, IBankScraperConfig>>,

  wellKnownSelectors: WELL_KNOWN_LOGIN_SELECTORS,
  wellKnownDashboardSelectors: WELL_KNOWN_DASHBOARD_SELECTORS,
} as const;
