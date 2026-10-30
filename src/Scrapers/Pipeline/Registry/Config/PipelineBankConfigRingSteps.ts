/**
 * Ring login steps — six POSTs to the gateway's `service` endpoint, each
 * naming its bank service in the query string. A cold run checks the ID
 * and password (steps 0–1), registers a device key (2–3), then signs in
 * with that key (4–5); a warm run starts at step 4 with a stored key.
 *
 * Every response carries a status code. The codes for a rejected ID or
 * password come from this repository's former web login.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IBodyTemplate,
  IEnvelopeSelectors,
  IOptionalExtract,
  IStepConfig,
  IStepOutcome,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { buildRingBodies, type IRingBodies } from './PipelineBankConfigRingBodies.js';
import type { IRingConstants } from './PipelineBankConfigRingConstants.js';

/** A ring step name — one per login body. */
type RingStepName = keyof IRingBodies;

/** The parts of a ring step that do not depend on the issuer. */
interface IRingStepSpec {
  readonly name: RingStepName;
  readonly serviceName: string;
  readonly outcome: IStepOutcome;
  readonly extractsToCarry?: IEnvelopeSelectors;
  readonly optionalExtractsToCarry?: Readonly<Record<string, IOptionalExtract>>;
}

/** Per-call headers: the bank's session key and a fresh trace id. */
const RING_STEP_HEADERS: Readonly<Record<string, JsonValueTemplate>> = {
  bckey: { $ref: 'carry.bcKey' },
  traceidentifier: { $ref: 'uuid' },
};

/** Device-key steps report `returnCode` in the same bean. */
const KEY_CHECK_OUTCOME: IStepOutcome = {
  codePointer: '/CustomerValidateKeyOtpBean/returnCode',
  successCodes: ['1'],
  failureMap: {},
  defaultFailure: ScraperErrorTypes.Generic,
};

const VALIDATE: IRingStepSpec = {
  name: 'validate',
  serviceName: 'ValidateIdDataNoReg',
  outcome: {
    codePointer: '/ValidateIdDataNoRegBean/returnCode',
    successCodes: ['1'],
    failureMap: { '4': ScraperErrorTypes.ChangePassword },
    defaultFailure: ScraperErrorTypes.InvalidPassword,
  },
  optionalExtractsToCarry: {
    bcKey: { pointer: '/ValidateIdDataNoRegBean/bcKey' },
    userName: { pointer: '/ValidateIdDataNoRegBean/userName' },
  },
};

const LOGIN: IRingStepSpec = {
  name: 'login',
  serviceName: 'performNewLogon',
  outcome: {
    codePointer: '/Header/Status',
    successCodes: ['1'],
    failureMap: { '3': ScraperErrorTypes.ChangePassword },
    defaultFailure: ScraperErrorTypes.InvalidPassword,
  },
};

const DEVICE_KEY: IRingStepSpec = {
  name: 'deviceKey',
  serviceName: 'CustomerValidateKeyOtp',
  outcome: KEY_CHECK_OUTCOME,
  extractsToCarry: { key: '/CustomerValidateKeyOtpBean/key' },
};

const REGISTER: IRingStepSpec = {
  name: 'register',
  serviceName: 'CustomerDataRegistration',
  outcome: { ...KEY_CHECK_OUTCOME, codePointer: '/CustomerDataRegistrationBean/returnCode' },
};

const RESUME: IRingStepSpec = {
  name: 'resume',
  serviceName: 'CustomerValidateKeyOtp',
  outcome: KEY_CHECK_OUTCOME,
  optionalExtractsToCarry: {
    key: { pointer: '/CustomerValidateKeyOtpBean/key' },
    bcKey: { pointer: '/CustomerValidateKeyOtpBean/bcKey' },
    userName: { pointer: '/CustomerValidateKeyOtpBean/userName' },
  },
};

/** The password was checked at step 1; a failure here is not a credential error. */
const SESSION_TOKEN: IRingStepSpec = {
  name: 'sessionToken',
  serviceName: 'performLogonOtp',
  outcome: { ...KEY_CHECK_OUTCOME, codePointer: '/CustomerLogonBean/returnCode' },
};

/** Step order; the warm path starts at RESUME (index 4). */
const RING_STEP_SPECS: readonly IRingStepSpec[] = [
  VALIDATE,
  LOGIN,
  DEVICE_KEY,
  REGISTER,
  RESUME,
  SESSION_TOKEN,
];

/** Index of the first warm-path step. */
const RING_WARM_STEP_INDEX = RING_STEP_SPECS.indexOf(RESUME);

/**
 * Build one ring step: the shared parts, the issuer's body and its app id.
 * @param spec - Issuer-independent step parts.
 * @param body - The issuer's body for this step.
 * @param applicationId - The issuer's `applicationId` query value.
 * @returns Step config.
 */
function ringStep(spec: IRingStepSpec, body: IBodyTemplate, applicationId: string): IStepConfig {
  const { serviceName, extractsToCarry = {}, ...rest } = spec;
  const app = { $literal: applicationId };
  const queryTemplate = { serviceName: { $literal: serviceName }, applicationId: app };
  const wire = { urlTag: 'auth.service', queryTemplate, headers: RING_STEP_HEADERS } as const;
  return { ...rest, ...wire, extractsToCarry, body };
}

/**
 * Build the six ring login steps for one issuer.
 * @param ring - Issuer constants.
 * @returns Steps, in order.
 */
function buildRingSteps(ring: IRingConstants): readonly IStepConfig[] {
  const bodies = buildRingBodies(ring.companyCode);
  return RING_STEP_SPECS.map((spec): IStepConfig =>
    ringStep(spec, bodies[spec.name], ring.applicationId),
  );
}

export { buildRingSteps, RING_WARM_STEP_INDEX };
