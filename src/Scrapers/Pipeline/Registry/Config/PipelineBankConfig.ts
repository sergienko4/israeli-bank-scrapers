/**
 * Pipeline bank registry — Zero-Knowledge config.
 * ONLY the official website URL. Nothing else.
 * All auth, API, proxy details discovered at runtime or owned by Strategy.
 */

import { CompanyTypes } from '../../../../Definitions.js';

/** Pipeline bank config — only what the HOME phase needs. */
export interface IPipelineBankConfig {
  /** Official website URL — HOME phase navigates here. */
  readonly urls: {
    readonly base: string;
  };
}

/** Pipeline bank registry — migrated banks only. */
const PIPELINE_BANK_CONFIG: Partial<Record<CompanyTypes, IPipelineBankConfig>> = {
  [CompanyTypes.Discount]: {
    urls: { base: 'https://www.discountbank.co.il' },
  },
  [CompanyTypes.VisaCal]: {
    urls: { base: 'https://www.cal-online.co.il/' },
  },
  [CompanyTypes.Amex]: {
    urls: { base: 'https://americanexpress.co.il' },
  },
  [CompanyTypes.Isracard]: {
    urls: { base: 'https://www.isracard.co.il' },
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

export default resolvePipelineBankConfig;
export { PIPELINE_BANK_CONFIG, resolvePipelineBankConfig };
