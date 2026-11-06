/**
 * Mercantile api-direct login: the Telebank family flow under Mercantile's
 * bank code, routing cookie, login page and id prefixes. Pure data (Rule #11).
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  buildTelebankApiDirectCall,
  buildTelebankHeadless,
} from './PipelineBankConfigTelebankFamily.js';
import type { ITelebankBrand } from './PipelineBankConfigTelebankFamilyConstants.js';
import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

const MERCANTILE_BRAND: ITelebankBrand = {
  bankCode: 'm',
  cssName: 'merkantil',
  loginPath: '/login/?bank=m',
  shortUidPrefix: '00011',
  longUidPrefix: '0001',
};

const MERCANTILE_API_DIRECT_CALL: IApiDirectCallConfig =
  buildTelebankApiDirectCall(MERCANTILE_BRAND);

const MERCANTILE_HEADLESS: IHeadlessUrlsConfig = buildTelebankHeadless(MERCANTILE_BRAND);

export default MERCANTILE_API_DIRECT_CALL;
export { MERCANTILE_API_DIRECT_CALL, MERCANTILE_HEADLESS };
