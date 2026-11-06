/**
 * Pagi api-direct login: Beinleumi's FIBI-family flow on Pagi's own online
 * origin, portal, Transmit app and bank number, its device remembered per
 * user. Pure data (Rule #11).
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { buildFibiApiDirectCall, buildFibiHeadless } from './PipelineBankConfigFibiFamily.js';
import type { IFibiBrand } from './PipelineBankConfigFibiFamilyConstants.js';
import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

const PAGI_BRAND: IFibiBrand = {
  origin: 'https://online.pagi.co.il',
  portalId: 'PAGIPORTAL',
  aid: 'rest_app_052',
  bankNum: '052',
  provider: 'pagi-web',
};

const PAGI_API_DIRECT_CALL: IApiDirectCallConfig = buildFibiApiDirectCall(PAGI_BRAND);

const PAGI_HEADLESS: IHeadlessUrlsConfig = buildFibiHeadless(PAGI_BRAND);

export default PAGI_API_DIRECT_CALL;
export { PAGI_API_DIRECT_CALL, PAGI_HEADLESS };
