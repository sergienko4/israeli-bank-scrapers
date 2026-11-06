/**
 * Pipeline bank registry — Zero-Knowledge config.
 * HOME phase URL for every migrated bank. Optional proxy-auth for
 * card banks. Optional OTP and headless-URL blocks. All runtime
 * details (tokens, cookies, session) discovered by Strategy.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import { AMEX_HEADLESS } from './PipelineBankConfigAmex.js';
import { BEINLEUMI_HEADLESS } from './PipelineBankConfigBeinleumi.js';
import { HAPOALIM_HEADLESS } from './PipelineBankConfigHapoalim.js';
import { ISRACARD_HEADLESS } from './PipelineBankConfigIsracard.js';
import { MASSAD_HEADLESS } from './PipelineBankConfigMassad.js';
import { MAX_HEADLESS } from './PipelineBankConfigMax.js';
import { MIZRAHI_HEADLESS } from './PipelineBankConfigMizrahi.js';
import { ONEZERO_HEADLESS } from './PipelineBankConfigOneZeroHeadless.js';
import { OTSAR_HAHAYAL_HEADLESS } from './PipelineBankConfigOtsarHahayal.js';
import { PAGI_HEADLESS } from './PipelineBankConfigPagi.js';
import { PEPPER_HEADLESS } from './PipelineBankConfigPepperHeadless.js';
import { seedWkFromPipelineConfig } from './PipelineBankConfigSeeder.js';
import type {
  AuthStrategyKind,
  BalanceKind,
  IHeadlessUrlsConfig,
  IPipelineBankConfig,
} from './PipelineBankConfigTypes.js';
import { VISACAL_HEADLESS } from './PipelineBankConfigVisaCalHeadless.js';
import { YAHAV_HEADLESS } from './PipelineBankConfigYahav.js';

export type {
  AuthPathKey,
  IHeadlessUrlsConfig,
  IPipelineBankConfig,
} from './PipelineBankConfigTypes.js';

/** Billing-cycle banks (credit-card companies) expose no account balance. */
const CARD_CYCLE = 'card-cycle';

/** Deposit/checking banks expose a real account balance resolved live. */
const ACCOUNT = 'account';

/** Banks whose completed login is carried by first-party session cookies. */
const SESSION_COOKIE = 'session-cookie';

/** API-native banks -- headless identity strategy, no browser AUTH-DISCOVERY. */
const API_DIRECT = 'api-direct';

/**
 * Build a plain bank config — base URL + balance/auth kinds, no
 * headless/OTP/poll blocks. Keeps the registry DRY: adding a simple
 * deposit or card bank is a single line; banks needing extra wiring
 * (API-direct headless, discovered-header bag) stay object-literal.
 * @param base - Official website URL (HOME phase navigates here).
 * @param balanceKind - Balance semantics (account vs card-cycle).
 * @param authStrategyKind - Auth-completion family.
 * @returns A pipeline bank config.
 */
function defineBank(
  base: string,
  balanceKind: BalanceKind,
  authStrategyKind: AuthStrategyKind,
): IPipelineBankConfig {
  return { urls: { base }, balanceKind, authStrategyKind };
}

/**
 * Build an API-native bank config: its login runs over the headless block's
 * transport, no browser AUTH-DISCOVERY.
 * @param base - Official website URL.
 * @param balanceKind - Balance semantics (account vs card-cycle).
 * @param headless - The bank's headless URL and transport block.
 * @returns A pipeline bank config.
 */
function defineApiDirectBank(
  base: string,
  balanceKind: BalanceKind,
  headless: IHeadlessUrlsConfig,
): IPipelineBankConfig {
  return { urls: { base }, balanceKind, authStrategyKind: API_DIRECT, headless };
}

/** Pipeline bank registry — migrated banks only. */
const PIPELINE_BANK_CONFIG: Partial<Record<CompanyTypes, IPipelineBankConfig>> = {
  [CompanyTypes.Beinleumi]: defineApiDirectBank(
    'https://www.fibi.co.il',
    ACCOUNT,
    BEINLEUMI_HEADLESS,
  ),
  [CompanyTypes.Leumi]: {
    ...defineBank('https://www.leumi.co.il', ACCOUNT, SESSION_COOKIE),
    sessionTokenCapture: {
      urlMatch: 'Broker.svc/ProcessRequest',
      bodyField: 'reqObj',
      tokenPath: ['SessionHeader', 'SessionID'],
    },
  },
  [CompanyTypes.Discount]: defineBank('https://www.discountbank.co.il', ACCOUNT, SESSION_COOKIE),
  [CompanyTypes.Hapoalim]: defineApiDirectBank(
    'https://www.bankhapoalim.co.il',
    ACCOUNT,
    HAPOALIM_HEADLESS,
  ),
  [CompanyTypes.Massad]: defineApiDirectBank(
    'https://www.bankmassad.co.il',
    ACCOUNT,
    MASSAD_HEADLESS,
  ),
  [CompanyTypes.OtsarHahayal]: defineApiDirectBank(
    'https://www.bankotsar.co.il',
    ACCOUNT,
    OTSAR_HAHAYAL_HEADLESS,
  ),
  [CompanyTypes.Pagi]: defineApiDirectBank('https://www.pagi.co.il', ACCOUNT, PAGI_HEADLESS),
  [CompanyTypes.Yahav]: defineApiDirectBank('https://www.yahav.co.il', ACCOUNT, YAHAV_HEADLESS),
  [CompanyTypes.VisaCal]: defineApiDirectBank(
    'https://www.cal-online.co.il/',
    CARD_CYCLE,
    VISACAL_HEADLESS,
  ),
  [CompanyTypes.Amex]: defineApiDirectBank(
    'https://www.americanexpress.co.il',
    CARD_CYCLE,
    AMEX_HEADLESS,
  ),
  [CompanyTypes.Max]: defineApiDirectBank('https://www.max.co.il', CARD_CYCLE, MAX_HEADLESS),
  [CompanyTypes.Mercantile]: defineBank('https://www.mercantile.co.il', ACCOUNT, SESSION_COOKIE),
  [CompanyTypes.Mizrahi]: defineApiDirectBank(
    'https://www.mizrahi-tefahot.co.il',
    ACCOUNT,
    MIZRAHI_HEADLESS,
  ),
  [CompanyTypes.Isracard]: defineApiDirectBank(
    'https://www.isracard.co.il',
    CARD_CYCLE,
    ISRACARD_HEADLESS,
  ),
  [CompanyTypes.OneZero]: defineApiDirectBank(
    'https://www.onezerobank.com',
    ACCOUNT,
    ONEZERO_HEADLESS,
  ),
  [CompanyTypes.PayBox]: {
    urls: { base: 'https://www.payboxapp.com/' },
    balanceKind: ACCOUNT,
    authStrategyKind: API_DIRECT,
    headless: {
      identityBase: 'https://apipin.payboxapp.com/api/2.0/',
      // PayBox has no GraphQL — set graphql to identityBase to satisfy the
      // type contract (scrape goes through REST via urlTag, not apiQuery).
      graphql: 'https://apipin.payboxapp.com/api/2.0/',
      paths: {
        'identity.phoneValidate': 'https://apipin.payboxapp.com/api/2.0/phoneValidate',
        'identity.pinValidation': 'https://apipin.payboxapp.com/api/2.0/pinValidation',
        'identity.loginBySms': 'https://apipin.payboxapp.com/api/2.0/loginBySms',
        'data.sync': 'https://apipin.payboxapp.com/api/2.0/sync',
        'data.getKey': 'https://apipin.payboxapp.com/api/2.0/getKey',
        'data.getUserHistory': 'https://apipin.payboxapp.com/api/2.0/getUserHistory',
        'data.virtualCardTranRequest':
          'https://apipin.payboxapp.com/api/2.0/virtualCardTranRequest',
      },
      phoneNumberFormat: 'international-dash',
      // PayBox's `apipin.payboxapp.com` sits behind Cloudflare which
      // returns a challenge page on root navigation. Camoufox (Firefox
      // TLS + HTTP/2) is required to match the WAF's accepted profile;
      // the route-intercept bypass on the initial origin nav avoids the
      // interstitial CSP that would otherwise block subsequent same-
      // origin fetches. Validated by
      // `c:/tmp/paybox-camoufox-probe3.mjs`.
      requiresBrowserTls: true,
      bypassOriginChallenge: true,
    },
  },
  [CompanyTypes.Pepper]: defineApiDirectBank('https://www.pepper.co.il', ACCOUNT, PEPPER_HEADLESS),
};

/**
 * Resolve pipeline bank config for a company.
 * @param companyId - The bank identifier.
 * @returns Pipeline bank config or false if not registered.
 */
function resolvePipelineBankConfig(companyId: CompanyTypes): IPipelineBankConfig | false {
  const config = PIPELINE_BANK_CONFIG[companyId];
  if (!config) return false;
  return config;
}

seedWkFromPipelineConfig(PIPELINE_BANK_CONFIG);

export default resolvePipelineBankConfig;
export { PIPELINE_BANK_CONFIG, resolvePipelineBankConfig };
