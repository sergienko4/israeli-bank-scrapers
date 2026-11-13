/**
 * Otsar Hahayal api-direct login: Beinleumi's FIBI-family flow on Otsar
 * Hahayal's own online origin, portal, Transmit app and bank number, its
 * device remembered per user. Pure data (Rule #11).
 */

import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { buildFibiApiDirectCall, buildFibiTransport } from './PipelineBankConfigFibiFamily.js';
import type { IFibiBrand } from './PipelineBankConfigFibiFamilyConstants.js';
import type { ITransportConfig } from './PipelineBankConfigTypes.js';

const OTSAR_HAHAYAL_BRAND: IFibiBrand = {
  origin: 'https://online.bankotsar.co.il',
  portalId: 'OTSARPRTAL',
  aid: 'rest_app_014',
  bankNum: '014',
  provider: 'otsar-hahayal-web',
};

const OTSAR_HAHAYAL_API_DIRECT_CALL: IApiDirectCallConfig =
  buildFibiApiDirectCall(OTSAR_HAHAYAL_BRAND);

const OTSAR_HAHAYAL_TRANSPORT: ITransportConfig = buildFibiTransport(OTSAR_HAHAYAL_BRAND);

export default OTSAR_HAHAYAL_API_DIRECT_CALL;
export { OTSAR_HAHAYAL_API_DIRECT_CALL, OTSAR_HAHAYAL_TRANSPORT };
