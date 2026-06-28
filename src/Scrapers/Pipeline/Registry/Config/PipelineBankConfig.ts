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
import HEADLESS_BANK_CONFIG from './PipelineBankConfigHeadless.js';
import { seedWkFromPipelineConfig } from './PipelineBankConfigSeeder.js';
import type { IPipelineBankConfig } from './PipelineBankConfigTypes.js';

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

/** Slow-AngularJS auth-confirm budget (Isracard, Amex). */
const LOGIN_AUTH_CONFIRM_ANGULAR_MS = 45_000;

/** Pipeline bank registry — migrated banks only. */
const PIPELINE_BANK_CONFIG: Partial<Record<CompanyTypes, IPipelineBankConfig>> = {
  [CompanyTypes.Beinleumi]: {
    urls: { base: 'https://www.fibi.co.il' },
    balanceKind: ACCOUNT,
    authStrategyKind: TOKEN,
  },
  [CompanyTypes.Leumi]: {
    urls: { base: 'https://www.leumi.co.il' },
    balanceKind: ACCOUNT,
    authStrategyKind: SESSION_COOKIE,
  },
  [CompanyTypes.Discount]: {
    urls: { base: 'https://www.discountbank.co.il' },
    balanceKind: ACCOUNT,
    authStrategyKind: SESSION_COOKIE,
  },
  [CompanyTypes.Hapoalim]: {
    urls: { base: 'https://www.bankhapoalim.co.il' },
    balanceKind: ACCOUNT,
    authStrategyKind: SESSION_COOKIE,
  },
  [CompanyTypes.Massad]: {
    urls: { base: 'https://www.bankmassad.co.il' },
    balanceKind: ACCOUNT,
    authStrategyKind: TOKEN,
  },
  [CompanyTypes.OtsarHahayal]: {
    urls: { base: 'https://www.bankotsar.co.il' },
    balanceKind: ACCOUNT,
    authStrategyKind: TOKEN,
  },
  [CompanyTypes.Pagi]: {
    urls: { base: 'https://www.pagi.co.il' },
    balanceKind: ACCOUNT,
    authStrategyKind: TOKEN,
  },
  [CompanyTypes.VisaCal]: {
    urls: { base: 'https://www.cal-online.co.il/' },
    balanceKind: CARD_CYCLE,
    authStrategyKind: TOKEN,
  },
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
  [CompanyTypes.Max]: {
    urls: { base: 'https://www.max.co.il' },
    balanceKind: CARD_CYCLE,
    authStrategyKind: SESSION_COOKIE,
  },
  [CompanyTypes.Mercantile]: {
    urls: { base: 'https://www.mercantile.co.il' },
    balanceKind: ACCOUNT,
    authStrategyKind: SESSION_COOKIE,
  },
  [CompanyTypes.Isracard]: {
    urls: { base: 'https://www.isracard.co.il' },
    balanceKind: CARD_CYCLE,
    loginAuthConfirmMs: LOGIN_AUTH_CONFIRM_ANGULAR_MS,
    authStrategyKind: SESSION_COOKIE,
  },
  [CompanyTypes.Yahav]: {
    urls: { base: 'https://www.yahav.co.il' },
    balanceKind: ACCOUNT,
    authStrategyKind: SESSION_COOKIE,
  },
  ...HEADLESS_BANK_CONFIG,
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
