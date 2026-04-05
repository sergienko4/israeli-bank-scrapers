/**
 * Pipeline bank registry — Zero-Knowledge config.
 * ONLY the official website URL. Nothing else.
 * All auth, API, proxy details discovered at runtime or owned by Strategy.
 */

import { CompanyTypes } from '../../../../Definitions.js';

/** Parametric proxy query params — date tokens resolved at runtime. */
export interface IProxyParams {
  /** Dashboard query params (e.g. { billingDate: 'YYYY-MM-01' }). */
  readonly dashboard?: Readonly<Record<string, string>>;
  /** Transaction query params (e.g. { month: 'MM', year: 'YYYY' }). */
  readonly transactions?: Readonly<Record<string, string>>;
}

/** Proxy auth params — injected via .withProxyAuth() for proxy-based banks. */
/** Company-specific code for proxy auth. */
type CompanyCode = string;
export interface IProxyAuth {
  /** Bank-specific company code (e.g. '77' for Amex, '11' for Isracard). */
  readonly companyCode: CompanyCode;
  /** Parametric query params for proxy API calls — date tokens resolved at runtime. */
  readonly params?: IProxyParams;
}

/** Bank website URL string. */
type BankUrl = string;

/** Pipeline bank config — HOME phase URL + optional proxy auth. */
export interface IPipelineBankConfig {
  /** Official website URL — HOME phase navigates here. */
  readonly urls: {
    readonly base: BankUrl;
  };
  /** Proxy auth params — for banks using ProxyRequestHandler login. */
  readonly auth?: IProxyAuth;
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
    auth: {
      companyCode: '77',
      params: {
        dashboard: { billingDate: 'YYYY-MM-01' },
        transactions: { month: 'MM', year: 'YYYY', requiredDate: 'N' },
      },
    },
  },
  [CompanyTypes.Max]: {
    urls: { base: 'https://www.max.co.il' },
  },
  [CompanyTypes.Isracard]: {
    urls: { base: 'https://www.isracard.co.il' },
    auth: {
      companyCode: '11',
      params: {
        dashboard: { billingDate: 'YYYY-MM-01' },
        transactions: { month: 'MM', year: 'YYYY', requiredDate: 'N' },
      },
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

export default resolvePipelineBankConfig;
export { PIPELINE_BANK_CONFIG, resolvePipelineBankConfig };
