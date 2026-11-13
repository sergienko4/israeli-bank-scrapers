/**
 * Massad api-direct login: Beinleumi's FIBI-family flow on Massad's own
 * online origin, portal, Transmit app and bank number, its device remembered
 * per user. Pure data (Rule #11).
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { buildFibiApiDirectCall, buildFibiTransport } from './PipelineBankConfigFibiFamily.js';
import type { IFibiBrand } from './PipelineBankConfigFibiFamilyConstants.js';
import type { ITransportConfig } from './PipelineBankConfigTypes.js';

const MASSAD_BRAND: IFibiBrand = {
  origin: 'https://online.bankmassad.co.il',
  portalId: 'MASADPRTAL',
  aid: 'rest_app_046',
  bankNum: '046',
  provider: 'massad-web',
};

const MASSAD_API_DIRECT_CALL: IApiDirectCallConfig = buildFibiApiDirectCall(MASSAD_BRAND);

const MASSAD_TRANSPORT: ITransportConfig = buildFibiTransport(MASSAD_BRAND);

export default MASSAD_API_DIRECT_CALL;
export { MASSAD_API_DIRECT_CALL, MASSAD_TRANSPORT };
