/**
 * Beinleumi group brands — what the mocked bank pins per bank: the online
 * origin every call names, the entry page's portal id, the Transmit app id,
 * the bank number and the device-memory provider. Each value is a literal
 * copied from the approved protocol, never imported from the bank config, so
 * a regression in a brand's config fails the mocked bank instead of moving it
 * along. The wire values a brand implies derive from it here.
 *
 * Rule #18: every value here is SYNTHETIC or public protocol text. No real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import { WIRE_PATHS } from './BeinleumiWireSpec.js';

/** One Beinleumi group bank, as the mocked bank sees it. */
export interface IFibiMockBrand {
  readonly companyId: CompanyTypes;
  /** The one origin every portal, Transmit, SSO and data call names. */
  readonly origin: string;
  /** The portal the login page belongs to. */
  readonly portalId: string;
  /** The Transmit app every Transmit call names as `aid`. */
  readonly aid: string;
  /** The bank number the login page states and the login call names. */
  readonly bankNum: string;
  /** The provider a stored device state is bound to. */
  readonly provider: string;
}

export const BEINLEUMI_MOCK_BRAND: IFibiMockBrand = {
  companyId: CompanyTypes.Beinleumi,
  origin: 'https://online.fibi.co.il',
  portalId: 'FIBIPORTAL',
  aid: 'rest_app_031',
  bankNum: '031',
  provider: 'beinleumi-web',
};

export const MASSAD_MOCK_BRAND: IFibiMockBrand = {
  companyId: CompanyTypes.Massad,
  origin: 'https://online.bankmassad.co.il',
  portalId: 'MASADPRTAL',
  aid: 'rest_app_046',
  bankNum: '046',
  provider: 'massad-web',
};

export const OTSAR_HAHAYAL_MOCK_BRAND: IFibiMockBrand = {
  companyId: CompanyTypes.OtsarHahayal,
  origin: 'https://online.bankotsar.co.il',
  portalId: 'OTSARPRTAL',
  aid: 'rest_app_014',
  bankNum: '014',
  provider: 'otsar-hahayal-web',
};

export const PAGI_MOCK_BRAND: IFibiMockBrand = {
  companyId: CompanyTypes.Pagi,
  origin: 'https://online.pagi.co.il',
  portalId: 'PAGIPORTAL',
  aid: 'rest_app_052',
  bankNum: '052',
  provider: 'pagi-web',
};

/** The group banks that run Beinleumi's login on their own brand. */
export const SIBLING_MOCK_BRANDS: readonly IFibiMockBrand[] = [
  MASSAD_MOCK_BRAND,
  OTSAR_HAHAYAL_MOCK_BRAND,
  PAGI_MOCK_BRAND,
];

/** Every brand covered by the shared behavior and privacy matrices. */
export const FIBI_MOCK_BRANDS: readonly IFibiMockBrand[] = [
  BEINLEUMI_MOCK_BRAND,
  ...SIBLING_MOCK_BRANDS,
];

/**
 * The login page's query: the brand's private-customer portal, in Hebrew.
 * @param brand - The bank.
 * @returns The exact query.
 */
export function entryQueryOf(brand: IFibiMockBrand): Readonly<Record<string, string>> {
  return { bankId: brand.portalId, site: 'Private', KODSAFA: 'HE' };
}

/**
 * The login page.
 * @param brand - The bank.
 * @returns Its URL.
 */
export function entryUrlOf(brand: IFibiMockBrand): string {
  const query = new URLSearchParams(entryQueryOf(brand));
  return `${brand.origin}${WIRE_PATHS.servlet}?${query.toString()}`;
}
