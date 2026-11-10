/**
 * Pipeline bank registry — Zero-Knowledge config.
 * HOME phase URL for every migrated bank. Optional proxy-auth for
 * card banks. Optional OTP and headless-URL blocks. All runtime
 * details (tokens, cookies, session) discovered by Strategy.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import { AMEX_HEADLESS } from './PipelineBankConfigAmex.js';
import { DISCOUNT_HEADLESS } from './PipelineBankConfigDiscount.js';
import {
  BEINLEUMI_HEADLESS,
  MASSAD_HEADLESS,
  OTSAR_HAHAYAL_HEADLESS,
  PAGI_HEADLESS,
} from './PipelineBankConfigFibiBrands.js';
import { HAPOALIM_HEADLESS } from './PipelineBankConfigHapoalim.js';
import { ISRACARD_HEADLESS } from './PipelineBankConfigIsracard.js';
import { LEUMI_HEADLESS } from './PipelineBankConfigLeumi.js';
import { MAX_HEADLESS } from './PipelineBankConfigMax.js';
import { MERCANTILE_HEADLESS } from './PipelineBankConfigMercantile.js';
import { MIZRAHI_HEADLESS } from './PipelineBankConfigMizrahi.js';
import { ONEZERO_HEADLESS } from './PipelineBankConfigOneZeroHeadless.js';
import { PEPPER_HEADLESS } from './PipelineBankConfigPepperHeadless.js';
import { seedWkFromPipelineConfig } from './PipelineBankConfigSeeder.js';
import type { IHeadlessUrlsConfig, IPipelineBankConfig } from './PipelineBankConfigTypes.js';
import { VISACAL_HEADLESS } from './PipelineBankConfigVisaCalHeadless.js';
import { YAHAV_HEADLESS } from './PipelineBankConfigYahav.js';

export type {
  AuthPathKey,
  IHeadlessUrlsConfig,
  IPipelineBankConfig,
} from './PipelineBankConfigTypes.js';

/**
 * Build an API-native bank config: its login runs over the headless block's
 * transport.
 * @param base - Official website URL (CI DNS apex).
 * @param headless - The bank's headless URL and transport block.
 * @returns A pipeline bank config.
 */
function defineApiDirectBank(base: string, headless: IHeadlessUrlsConfig): IPipelineBankConfig {
  return { urls: { base }, headless };
}

/** Pipeline bank registry — migrated banks only. */
const PIPELINE_BANK_CONFIG: Partial<Record<CompanyTypes, IPipelineBankConfig>> = {
  [CompanyTypes.Beinleumi]: defineApiDirectBank('https://www.fibi.co.il', BEINLEUMI_HEADLESS),
  [CompanyTypes.Leumi]: defineApiDirectBank('https://www.leumi.co.il', LEUMI_HEADLESS),
  [CompanyTypes.Discount]: defineApiDirectBank('https://www.discountbank.co.il', DISCOUNT_HEADLESS),
  [CompanyTypes.Hapoalim]: defineApiDirectBank('https://www.bankhapoalim.co.il', HAPOALIM_HEADLESS),
  [CompanyTypes.Massad]: defineApiDirectBank('https://www.bankmassad.co.il', MASSAD_HEADLESS),
  [CompanyTypes.OtsarHahayal]: defineApiDirectBank(
    'https://www.bankotsar.co.il',
    OTSAR_HAHAYAL_HEADLESS,
  ),
  [CompanyTypes.Pagi]: defineApiDirectBank('https://www.pagi.co.il', PAGI_HEADLESS),
  [CompanyTypes.Yahav]: defineApiDirectBank('https://www.yahav.co.il', YAHAV_HEADLESS),
  [CompanyTypes.VisaCal]: defineApiDirectBank('https://www.cal-online.co.il/', VISACAL_HEADLESS),
  [CompanyTypes.Amex]: defineApiDirectBank('https://www.americanexpress.co.il', AMEX_HEADLESS),
  [CompanyTypes.Max]: defineApiDirectBank('https://www.max.co.il', MAX_HEADLESS),
  [CompanyTypes.Mercantile]: defineApiDirectBank(
    'https://www.mercantile.co.il',
    MERCANTILE_HEADLESS,
  ),
  [CompanyTypes.Mizrahi]: defineApiDirectBank(
    'https://www.mizrahi-tefahot.co.il',
    MIZRAHI_HEADLESS,
  ),
  [CompanyTypes.Isracard]: defineApiDirectBank('https://www.isracard.co.il', ISRACARD_HEADLESS),
  [CompanyTypes.OneZero]: defineApiDirectBank('https://www.onezerobank.com', ONEZERO_HEADLESS),
  [CompanyTypes.PayBox]: {
    urls: { base: 'https://www.payboxapp.com/' },
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
      // `apipin.payboxapp.com` is Cloudflare-fronted but serves the app's JSON
      // API to Node's own fetch without a challenge, so no browser identity
      // is needed to reach it.
      nativeFetch: true,
      // Every PayBox call is a single hop: a connect timeout is then retried on
      // a fresh connection without resending a POST that already reached the server.
      redirectPolicy: 'reject',
    },
  },
  [CompanyTypes.Pepper]: defineApiDirectBank('https://www.pepper.co.il', PEPPER_HEADLESS),
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
