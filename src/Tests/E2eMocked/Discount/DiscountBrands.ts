/**
 * Telebank group brands — what the mocked bank pins per bank: the company,
 * the bank code getInfo and login name, the `cssName` cookie the login page
 * needs, the login page's query and the prefix an id's `Uid` starts with.
 * Each value is a literal copied from the bank's protocol, never imported
 * from the bank config, so a regression in a brand's config fails the
 * mocked bank instead of moving it along. The wire values a brand implies
 * derive from it here.
 *
 * Rule #18: every value here is SYNTHETIC or public protocol text. No real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import { DC_CLIENT_COOKIES } from './DiscountMockData.js';

/** One Telebank group bank, as the mocked bank sees it. */
export interface ITelebankMockBrand {
  readonly companyId: CompanyTypes;
  /** The bank code getInfo and login name as `Bank`. */
  readonly bankCode: string;
  /** The `cssName` cookie the login page needs. */
  readonly cssName: string;
  /** The login page's query; '' when it has none. */
  readonly loginQuery: string;
  /** What the `Uid` of an id of up to nine digits starts with. */
  readonly shortUidPrefix: string;
}

export const DISCOUNT_MOCK_BRAND: ITelebankMockBrand = {
  companyId: CompanyTypes.Discount,
  bankCode: 'd',
  cssName: 'discount',
  loginQuery: '',
  shortUidPrefix: '00001',
};

/**
 * The client cookies the prime step sets before its request.
 * @param brand - The bank.
 * @returns Its `cssName`, then the cookies every brand sets.
 */
export function primeCookiesOf(brand: ITelebankMockBrand): readonly string[] {
  return [`cssName=${brand.cssName}`, ...DC_CLIENT_COOKIES];
}

/**
 * The getInfo body, byte for byte.
 * @param brand - The bank.
 * @returns The JSON text, naming the brand's bank code.
 */
export function getInfoBodyOf(brand: ITelebankMockBrand): string {
  const bank = `"Bank":"${brand.bankCode}"`;
  return `{"Application":"WEB","Caller":"Internet",${bank},"Lang":"he","CustType":"private","Source":1}`;
}

/**
 * The `Uid` an id formats to.
 * @param brand - The bank.
 * @param id - The customer's id.
 * @returns The brand's prefix, then the id padded to nine digits.
 */
export function uidOf(brand: ITelebankMockBrand, id: string): string {
  return `${brand.shortUidPrefix}${id.padStart(9, '0')}`;
}
