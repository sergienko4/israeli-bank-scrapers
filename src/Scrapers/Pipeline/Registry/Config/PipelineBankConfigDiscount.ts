/**
 * Discount api-direct login: the Telebank family flow under Discount's bank
 * code, routing cookie, login page and id prefixes. Pure data (Rule #11).
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  buildTelebankApiDirectCall,
  buildTelebankHeadless,
} from './PipelineBankConfigTelebankFamily.js';
import type { ITelebankBrand } from './PipelineBankConfigTelebankFamilyConstants.js';
import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

const DISCOUNT_BRAND: ITelebankBrand = {
  bankCode: 'd',
  cssName: 'discount',
  loginPath: '/login/',
  shortUidPrefix: '00001',
  longUidPrefix: '0000',
};

const DISCOUNT_API_DIRECT_CALL: IApiDirectCallConfig = buildTelebankApiDirectCall(DISCOUNT_BRAND);

const DISCOUNT_HEADLESS: IHeadlessUrlsConfig = buildTelebankHeadless(DISCOUNT_BRAND);

export default DISCOUNT_API_DIRECT_CALL;
export { DISCOUNT_API_DIRECT_CALL, DISCOUNT_HEADLESS };
