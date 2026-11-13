/**
 * Login-step constants shared by the CA steps and the device-registration
 * steps: the app header set, the states that refuse the login, and the
 * new-device gate.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IStepOutcome } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { HAPOALIM_AUTH_HEADERS } from './PipelineBankConfigHapoalimConstants.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

/** App identity headers, plus a fresh trace id per step. */
const AUTH_HEADERS = {
  ...literalHeaders(HAPOALIM_AUTH_HEADERS),
  'x-b3-traceid': { $ref: 'uuid' } as const,
};

/** The states that refuse the login, whatever their case. */
const REFUSED_STATES: IStepOutcome['failureMap'] = {
  locked: ScraperErrorTypes.AccountBlocked,
  disabled: ScraperErrorTypes.AccountBlocked,
  reissue: ScraperErrorTypes.ChangePassword,
};

/** The device registration runs only when verify reported a new device. */
const NEW_DEVICE = { carry: 'newDevice', oneOf: ['newdevice'] } as const;

export { AUTH_HEADERS, NEW_DEVICE, REFUSED_STATES };
