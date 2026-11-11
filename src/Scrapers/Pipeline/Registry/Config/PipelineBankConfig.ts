/**
 * Pipeline bank registry — Zero-Knowledge config.
 * HOME phase URL for every migrated bank. Optional proxy-auth for
 * card banks. Optional OTP and headless-URL blocks. All runtime
 * details (tokens, cookies, session) discovered by Strategy.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import { AMEX_TRANSPORT } from './PipelineBankConfigAmex.js';
import { DISCOUNT_TRANSPORT } from './PipelineBankConfigDiscount.js';
import {
  BEINLEUMI_TRANSPORT,
  MASSAD_TRANSPORT,
  OTSAR_HAHAYAL_TRANSPORT,
  PAGI_TRANSPORT,
} from './PipelineBankConfigFibiBrands.js';
import { HAPOALIM_TRANSPORT } from './PipelineBankConfigHapoalim.js';
import { ISRACARD_TRANSPORT } from './PipelineBankConfigIsracard.js';
import { LEUMI_TRANSPORT } from './PipelineBankConfigLeumi.js';
import { MAX_TRANSPORT } from './PipelineBankConfigMax.js';
import { MERCANTILE_TRANSPORT } from './PipelineBankConfigMercantile.js';
import { MIZRAHI_TRANSPORT } from './PipelineBankConfigMizrahi.js';
import { ONEZERO_TRANSPORT } from './PipelineBankConfigOneZeroTransport.js';
import { PEPPER_TRANSPORT } from './PipelineBankConfigPepperTransport.js';
import { seedWkFromPipelineConfig } from './PipelineBankConfigSeeder.js';
import type { IPipelineBankConfig, ITransportConfig } from './PipelineBankConfigTypes.js';
import { VISACAL_TRANSPORT } from './PipelineBankConfigVisaCalTransport.js';
import { YAHAV_TRANSPORT } from './PipelineBankConfigYahav.js';

export type {
  AuthPathKey,
  IPipelineBankConfig,
  ITransportConfig,
} from './PipelineBankConfigTypes.js';

/**
 * Build an API-native bank config: its login runs over the transport block.
 * @param base - Official website URL (CI DNS apex).
 * @param transport - The bank's pure-HTTP transport configuration.
 * @returns A pipeline bank config.
 */
function defineApiDirectBank(base: string, transport: ITransportConfig): IPipelineBankConfig {
  return { urls: { base }, transport };
}

/** Pipeline bank registry — migrated banks only. */
const PIPELINE_BANK_CONFIG: Partial<Record<CompanyTypes, IPipelineBankConfig>> = {
  [CompanyTypes.Beinleumi]: defineApiDirectBank('https://www.fibi.co.il', BEINLEUMI_TRANSPORT),
  [CompanyTypes.Leumi]: defineApiDirectBank('https://www.leumi.co.il', LEUMI_TRANSPORT),
  [CompanyTypes.Discount]: defineApiDirectBank(
    'https://www.discountbank.co.il',
    DISCOUNT_TRANSPORT,
  ),
  [CompanyTypes.Hapoalim]: defineApiDirectBank(
    'https://www.bankhapoalim.co.il',
    HAPOALIM_TRANSPORT,
  ),
  [CompanyTypes.Massad]: defineApiDirectBank('https://www.bankmassad.co.il', MASSAD_TRANSPORT),
  [CompanyTypes.OtsarHahayal]: defineApiDirectBank(
    'https://www.bankotsar.co.il',
    OTSAR_HAHAYAL_TRANSPORT,
  ),
  [CompanyTypes.Pagi]: defineApiDirectBank('https://www.pagi.co.il', PAGI_TRANSPORT),
  [CompanyTypes.Yahav]: defineApiDirectBank('https://www.yahav.co.il', YAHAV_TRANSPORT),
  [CompanyTypes.VisaCal]: defineApiDirectBank('https://www.cal-online.co.il/', VISACAL_TRANSPORT),
  [CompanyTypes.Amex]: defineApiDirectBank('https://www.americanexpress.co.il', AMEX_TRANSPORT),
  [CompanyTypes.Max]: defineApiDirectBank('https://www.max.co.il', MAX_TRANSPORT),
  [CompanyTypes.Mercantile]: defineApiDirectBank(
    'https://www.mercantile.co.il',
    MERCANTILE_TRANSPORT,
  ),
  [CompanyTypes.Mizrahi]: defineApiDirectBank(
    'https://www.mizrahi-tefahot.co.il',
    MIZRAHI_TRANSPORT,
  ),
  [CompanyTypes.Isracard]: defineApiDirectBank('https://www.isracard.co.il', ISRACARD_TRANSPORT),
  [CompanyTypes.OneZero]: defineApiDirectBank('https://www.onezerobank.com', ONEZERO_TRANSPORT),
  [CompanyTypes.PayBox]: {
    urls: { base: 'https://www.payboxapp.com/' },
    transport: {
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
  [CompanyTypes.Pepper]: defineApiDirectBank('https://www.pepper.co.il', PEPPER_TRANSPORT),
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
