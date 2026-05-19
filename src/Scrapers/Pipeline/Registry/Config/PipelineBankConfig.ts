/**
 * Pipeline bank registry — Zero-Knowledge config.
 * HOME phase URL for every migrated bank. Optional proxy-auth for
 * card banks. Optional OTP and headless-URL blocks. All runtime
 * details (tokens, cookies, session) discovered by Strategy.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import { seedWkFromPipelineConfig } from './PipelineBankConfigSeeder.js';
import type { IPipelineBankConfig } from './PipelineBankConfigTypes.js';

export type {
  AuthPathKey,
  IHeadlessUrlsConfig,
  IPipelineBankConfig,
} from './PipelineBankConfigTypes.js';

/** Pipeline bank registry — migrated banks only. */
const PIPELINE_BANK_CONFIG: Partial<Record<CompanyTypes, IPipelineBankConfig>> = {
  [CompanyTypes.Beinleumi]: {
    urls: { base: 'https://www.fibi.co.il' },
  },
  [CompanyTypes.Discount]: {
    urls: { base: 'https://www.discountbank.co.il' },
  },
  [CompanyTypes.Hapoalim]: {
    // Hapoalim: navigate directly to the login page so the pipeline
    // can skip HOME entirely (see `.withSkipHome()` in HapoalimPipeline.ts).
    // The marketing homepage at `www.bankhapoalim.co.il` exposes the silent
    // DOM-scan window that triggers the chronic hCaptcha challenge in CI;
    // going straight to the login-page subdomain bypasses that surface.
    urls: { base: 'https://login.bankhapoalim.co.il/ng-portals/auth/he/' },
  },
  [CompanyTypes.Massad]: {
    urls: { base: 'https://www.bankmassad.co.il' },
  },
  [CompanyTypes.OtsarHahayal]: {
    urls: { base: 'https://www.bankotsar.co.il' },
  },
  [CompanyTypes.Pagi]: {
    urls: { base: 'https://www.pagi.co.il' },
  },
  [CompanyTypes.VisaCal]: {
    urls: { base: 'https://www.cal-online.co.il/' },
  },
  [CompanyTypes.Amex]: {
    urls: { base: 'https://americanexpress.co.il' },
  },
  [CompanyTypes.Max]: {
    urls: { base: 'https://www.max.co.il' },
  },
  [CompanyTypes.Mercantile]: {
    urls: { base: 'https://www.mercantile.co.il' },
  },
  [CompanyTypes.Isracard]: {
    urls: { base: 'https://www.isracard.co.il' },
  },
  [CompanyTypes.OneZero]: {
    urls: { base: 'https://www.onezerobank.com' },
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
    },
  },
  [CompanyTypes.Pepper]: {
    urls: { base: 'https://www.pepper.co.il' },
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
