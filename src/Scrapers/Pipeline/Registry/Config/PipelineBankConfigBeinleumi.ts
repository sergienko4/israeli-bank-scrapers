/**
 * Beinleumi api-direct login: the FIBI-family flow on the
 * bank's own online origin, its device remembered per user. Pure data
 * (Rule #11).
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { buildFibiApiDirectCall, buildFibiHeadless } from './PipelineBankConfigFibiFamily.js';
import type { IFibiBrand } from './PipelineBankConfigFibiFamilyConstants.js';
import type { ITransportConfig } from './PipelineBankConfigTypes.js';

const BEINLEUMI_BRAND: IFibiBrand = {
  origin: 'https://online.fibi.co.il',
  portalId: 'FIBIPORTAL',
  aid: 'rest_app_031',
  bankNum: '031',
  provider: 'beinleumi-web',
};

const BEINLEUMI_API_DIRECT_CALL: IApiDirectCallConfig = buildFibiApiDirectCall(BEINLEUMI_BRAND);

const BEINLEUMI_TRANSPORT: ITransportConfig = buildFibiHeadless(BEINLEUMI_BRAND);

export default BEINLEUMI_API_DIRECT_CALL;
export { BEINLEUMI_API_DIRECT_CALL, BEINLEUMI_TRANSPORT };
