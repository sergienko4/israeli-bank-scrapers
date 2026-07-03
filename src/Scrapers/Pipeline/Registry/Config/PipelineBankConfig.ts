/**
 * Pipeline bank registry — Zero-Knowledge config.
 * HOME phase URL for every migrated bank. Optional proxy-auth for
 * card banks. Optional OTP and headless-URL blocks. All runtime
 * details (tokens, cookies, session) discovered by Strategy.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import {
  LOGIN_COMPLETION_POLL_INTERVAL_MS,
  LOGIN_COMPLETION_POLL_MAX_ATTEMPTS,
} from '../../Mediator/Timing/LoginTimingConfig.js';
import { seedWkFromPipelineConfig } from './PipelineBankConfigSeeder.js';
import type {
  AuthStrategyKind,
  BalanceKind,
  IPipelineBankConfig,
} from './PipelineBankConfigTypes.js';

export type {
  AuthPathKey,
  IHeadlessUrlsConfig,
  IPipelineBankConfig,
} from './PipelineBankConfigTypes.js';

/** Billing-cycle banks (credit-card companies) expose no account balance. */
const CARD_CYCLE = 'card-cycle';

/** Deposit/checking banks expose a real account balance resolved live. */
const ACCOUNT = 'account';

/** Banks whose completed login yields a discovered Bearer/JWT token. */
const TOKEN = 'token';

/** Banks whose completed login is carried by first-party session cookies. */
const SESSION_COOKIE = 'session-cookie';

/** API-native banks -- headless identity strategy, no browser AUTH-DISCOVERY. */
const API_DIRECT = 'api-direct';

/** Slow-AngularJS auth-confirm budget (Isracard, Amex). */
const LOGIN_AUTH_CONFIRM_ANGULAR_MS = 45_000;

/**
 * Build a plain bank config — base URL + balance/auth kinds, no
 * headless/OTP/poll blocks. Keeps the registry DRY: adding a simple
 * deposit or card bank is a single line; banks needing extra wiring
 * (Amex/Isracard poll, API-direct headless) stay object-literal.
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

/** Pipeline bank registry — migrated banks only. */
const PIPELINE_BANK_CONFIG: Partial<Record<CompanyTypes, IPipelineBankConfig>> = {
  [CompanyTypes.Beinleumi]: defineBank('https://www.fibi.co.il', ACCOUNT, TOKEN),
  [CompanyTypes.Leumi]: defineBank('https://www.leumi.co.il', ACCOUNT, SESSION_COOKIE),
  [CompanyTypes.Discount]: defineBank('https://www.discountbank.co.il', ACCOUNT, SESSION_COOKIE),
  [CompanyTypes.Hapoalim]: defineBank('https://www.bankhapoalim.co.il', ACCOUNT, SESSION_COOKIE),
  [CompanyTypes.Massad]: defineBank('https://www.bankmassad.co.il', ACCOUNT, TOKEN),
  [CompanyTypes.OtsarHahayal]: defineBank('https://www.bankotsar.co.il', ACCOUNT, TOKEN),
  [CompanyTypes.Pagi]: defineBank('https://www.pagi.co.il', ACCOUNT, TOKEN),
  [CompanyTypes.Yahav]: defineBank('https://www.yahav.co.il', ACCOUNT, SESSION_COOKIE),
  [CompanyTypes.VisaCal]: defineBank('https://www.cal-online.co.il/', CARD_CYCLE, TOKEN),
  [CompanyTypes.Amex]: {
    urls: { base: 'https://www.americanexpress.co.il' },
    balanceKind: CARD_CYCLE,
    loginAuthConfirmMs: LOGIN_AUTH_CONFIRM_ANGULAR_MS,
    loginCompletionPoll: {
      intervalMs: LOGIN_COMPLETION_POLL_INTERVAL_MS,
      maxAttempts: LOGIN_COMPLETION_POLL_MAX_ATTEMPTS,
    },
    authStrategyKind: SESSION_COOKIE,
  },
  [CompanyTypes.Max]: defineBank('https://www.max.co.il', CARD_CYCLE, SESSION_COOKIE),
  [CompanyTypes.Mercantile]: defineBank('https://www.mercantile.co.il', ACCOUNT, SESSION_COOKIE),
  [CompanyTypes.Isracard]: {
    urls: { base: 'https://www.isracard.co.il' },
    balanceKind: CARD_CYCLE,
    loginAuthConfirmMs: LOGIN_AUTH_CONFIRM_ANGULAR_MS,
    authStrategyKind: SESSION_COOKIE,
  },
  [CompanyTypes.OneZero]: {
    urls: { base: 'https://www.onezerobank.com' },
    balanceKind: ACCOUNT,
    authStrategyKind: API_DIRECT,
    headless: {
      identityBase: 'https://identity.tfd-bank.com/v1/',
      graphql: 'https://mobile.tfd-bank.com/mobile-graph/graphql',
      paths: {
        'identity.deviceToken': 'https://identity.tfd-bank.com/v1/devices/token',
        'identity.otpPrepare': 'https://identity.tfd-bank.com/v1/otp/prepare',
        'identity.otpVerify': 'https://identity.tfd-bank.com/v1/otp/verify',
        'identity.getIdToken': 'https://identity.tfd-bank.com/v1/getIdToken',
        'identity.sessionToken': 'https://identity.tfd-bank.com/v1/sessions/token',
      },
      requiresBrowserTls: true,
      phoneNumberFormat: 'international-plus',
    },
  },
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
  [CompanyTypes.Pepper]: {
    urls: { base: 'https://www.pepper.co.il' },
    balanceKind: ACCOUNT,
    authStrategyKind: API_DIRECT,
    headless: {
      identityBase: 'https://sa.pepper.co.il/',
      graphql: 'https://fe-sec.pepper.co.il/graphql',
      paths: {
        'auth.bind': 'https://sa.pepper.co.il/api/v2/auth/bind',
        'auth.assert': 'https://sa.pepper.co.il/api/v2/auth/assert',
        'auth.logout': 'https://sa.pepper.co.il/api/v2/auth/logout',
      },
      // Public Transmit Security client ID (equivalent to User-Agent / public API key).
      // Extracted from com.pepper.ldb APK index.android.bundle and identical
      // across every Play Store install — not a user secret.
      staticAuth: 'TSToken 7cf2d7a7-681d-450a-ab23-06e48d2b8fd6; tid=digital_client_token_token',
      requiresBrowserTls: true,
      phoneNumberFormat: 'international-flat',
    },
  },
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
