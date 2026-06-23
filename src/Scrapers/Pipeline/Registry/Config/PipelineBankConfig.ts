/**
 * Pipeline bank registry — Zero-Knowledge config.
 * HOME phase URL for every migrated bank. Optional proxy-auth for
 * card banks. Optional OTP and headless-URL blocks. All runtime
 * details (tokens, cookies, session) discovered by Strategy.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import { seedWkFromPipelineConfig } from './PipelineBankConfigSeeder.js';
import type { BalanceKind, IPipelineBankConfig } from './PipelineBankConfigTypes.js';

export type {
  AuthPathKey,
  IHeadlessUrlsConfig,
  IPipelineBankConfig,
} from './PipelineBankConfigTypes.js';

/** Billing-cycle banks (credit-card companies) expose no account balance. */
const CARD_CYCLE: BalanceKind = 'card-cycle';

/** Deposit/checking banks expose a real account balance resolved live. */
const ACCOUNT: BalanceKind = 'account';

/** Slow-AngularJS auth-confirm budget (Isracard). */
const LOGIN_AUTH_CONFIRM_ANGULAR_MS = 45_000;

/**
 * Extended auth-confirm budget for Amex (Phase-2A CI slow-walk experiment).
 *
 * The Amex auth XHR fires — Google-Ads `form_submit` and GA4 analytics
 * confirm it ran — but no first-party `americanexpress.co.il` response
 * returns within the 45 s Angular budget from the CI datacenter IP (the
 * byte-identical code passes on residential IPs). Two live hypotheses are
 * being tested: #1 the auth slow-walks under datacenter-IP scrutiny, which
 * a wider window lets settle before the pipeline declares a timeout; #3 a
 * hard datacenter-IP block, which still fails honestly at LOGIN after this
 * budget rather than confusingly at account-resolve, making diagnosis clear.
 */
const LOGIN_AUTH_CONFIRM_AMEX_MS = 120_000;

/** Pipeline bank registry — migrated banks only. */
const PIPELINE_BANK_CONFIG: Partial<Record<CompanyTypes, IPipelineBankConfig>> = {
  [CompanyTypes.Beinleumi]: {
    urls: { base: 'https://www.fibi.co.il' },
    balanceKind: ACCOUNT,
  },
  [CompanyTypes.Discount]: {
    urls: { base: 'https://www.discountbank.co.il' },
    balanceKind: ACCOUNT,
  },
  [CompanyTypes.Hapoalim]: {
    urls: { base: 'https://www.bankhapoalim.co.il' },
    balanceKind: ACCOUNT,
  },
  [CompanyTypes.Massad]: {
    urls: { base: 'https://www.bankmassad.co.il' },
    balanceKind: ACCOUNT,
  },
  [CompanyTypes.OtsarHahayal]: {
    urls: { base: 'https://www.bankotsar.co.il' },
    balanceKind: ACCOUNT,
  },
  [CompanyTypes.Pagi]: {
    urls: { base: 'https://www.pagi.co.il' },
    balanceKind: ACCOUNT,
  },
  [CompanyTypes.VisaCal]: {
    urls: { base: 'https://www.cal-online.co.il/' },
    balanceKind: CARD_CYCLE,
  },
  [CompanyTypes.Amex]: {
    urls: { base: 'https://americanexpress.co.il' },
    balanceKind: CARD_CYCLE,
    loginAuthConfirmMs: LOGIN_AUTH_CONFIRM_AMEX_MS,
  },
  [CompanyTypes.Max]: {
    urls: { base: 'https://www.max.co.il' },
    balanceKind: CARD_CYCLE,
  },
  [CompanyTypes.Mercantile]: {
    urls: { base: 'https://www.mercantile.co.il' },
    balanceKind: ACCOUNT,
  },
  [CompanyTypes.Isracard]: {
    urls: { base: 'https://www.isracard.co.il' },
    balanceKind: CARD_CYCLE,
    loginAuthConfirmMs: LOGIN_AUTH_CONFIRM_ANGULAR_MS,
  },
  [CompanyTypes.OneZero]: {
    urls: { base: 'https://www.onezerobank.com' },
    balanceKind: ACCOUNT,
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
