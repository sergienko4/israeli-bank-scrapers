/**
 * Ring login request bodies — the exact field sets the ring mobile gateway
 * accepts. The fields every issuer sends alike are module constants; each
 * builder adds the issuer's `companyCode`.
 *
 * Carry slots read here: `userName` (the bank's user code, empty until a
 * response supplies one), `bcKey` (the bank's per-session key), `udid` (the
 * device id derived from the ID number) and `key` (the device key the bank
 * issues at registration).
 */

import type {
  IBodyTemplate,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { RING_WALLET_ID } from './PipelineBankConfigRingConstants.js';

const ONE = { $literal: '1' } as const;
const ZERO = { $literal: '0' } as const;
const COUNTRY = { $literal: '212' } as const;
const RETURN_MESSAGE = { $literal: 'true' } as const;
const AP = { $literal: 'MisparZihuy' } as const;
const ID = { $ref: 'creds.id' } as const;
const CARD6 = { $ref: 'creds.card6Digits' } as const;
const USER_NAME = { $ref: 'carry.userName' } as const;
const UDID = { $ref: 'carry.udid' } as const;
const KEY = { $ref: 'carry.key' } as const;

/** Device fields the device-key steps send alike. */
const DEVICE = { MAC: ONE, UDID, ARRAY: ZERO } as const;

/** Step 0 — check the ID number and card digits. */
const VALIDATE_FIELDS = {
  id: ID,
  idType: ONE,
  cardSuffix: CARD6,
  countryCode: COUNTRY,
  checkLevel: ONE,
  returnMessage: RETURN_MESSAGE,
  reqName: { $literal: 'ValidateIdDataNoReg' },
  loginTypeId: ONE,
} as const;

/** Step 1 — the password login; the same for every issuer. */
const LOGIN_BODY: IBodyTemplate = {
  shape: {
    MisparZihuy: ID,
    KodMishtamesh: USER_NAME,
    Sisma: { $ref: 'creds.password' },
    KodZihuy: ONE,
    KodEretz: COUNTRY,
    returnMessage: RETURN_MESSAGE,
    ap: AP,
    reqName: { $literal: 'performNewLogon' },
    bcKey: { $ref: 'carry.bcKey' },
  },
};

/** Fields both device-key checks send. */
const KEY_CHECK_FIELDS = {
  reqName: { $literal: 'CustomerValidateKeyOtp' },
  applicationSource: ONE,
  returnMessage: RETURN_MESSAGE,
  ...DEVICE,
} as const;

/** Step 2 — ask the bank for a device key for this device id. */
const DEVICE_KEY_FIELDS = {
  ...KEY_CHECK_FIELDS,
  checkLevel: { $literal: '9' },
  idType: ONE,
  countryCode: COUNTRY,
  idNumber: ID,
  cardSuffix: CARD6,
} as const;

/** Step 3 — register the device key. */
const REGISTER_FIELDS = {
  reqName: { $literal: 'CustomerDataRegistration' },
  idNumber: ID,
  idType: ONE,
  countryCode: COUNTRY,
  activityType: ONE,
  applicationSource: ONE,
  defaultIdMethod: ONE,
  entryMethod: ONE,
  key: KEY,
  ...DEVICE,
  returnMessage: RETURN_MESSAGE,
} as const;

/** Step 4 — sign in with the device key; the warm path starts here. */
const RESUME_FIELDS = {
  ...KEY_CHECK_FIELDS,
  checkLevel: { $literal: '4' },
  idMethod: ONE,
  key: KEY,
} as const;

/** Step 5 — open the data session; the same for every issuer. */
const SESSION_TOKEN_BODY: IBodyTemplate = {
  shape: {
    reqName: { $literal: 'performLogonOtp' },
    MisparZihuy: ID,
    KodZihuy: ONE,
    KodEretz: COUNTRY,
    countryCode: COUNTRY,
    KodMedina: COUNTRY,
    KodMishtamesh: USER_NAME,
    otpSMS: { $literal: false },
    returnMessage: RETURN_MESSAGE,
    ap: AP,
    paymentAppInstanceId: { $literal: '' },
    walletId: { $literal: RING_WALLET_ID },
  },
};

/** Login bodies for one issuer. */
interface IRingBodies {
  readonly validate: IBodyTemplate;
  readonly login: IBodyTemplate;
  readonly deviceKey: IBodyTemplate;
  readonly register: IBodyTemplate;
  readonly resume: IBodyTemplate;
  readonly sessionToken: IBodyTemplate;
}

/**
 * Add the issuer's company code to a shared field set.
 * @param fields - Fields every issuer sends alike.
 * @param companyCode - Issuer company code template.
 * @returns Body template.
 */
function withCompany(
  fields: Readonly<Record<string, JsonValueTemplate>>,
  companyCode: JsonValueTemplate,
): IBodyTemplate {
  return { shape: { ...fields, companyCode } };
}

/**
 * Build the six login bodies for one issuer.
 * @param companyCode - Issuer company code.
 * @returns Login bodies, in step order.
 */
function buildRingBodies(companyCode: string): IRingBodies {
  const company = { $literal: companyCode };
  const shared = { login: LOGIN_BODY, sessionToken: SESSION_TOKEN_BODY };
  const validate = withCompany(VALIDATE_FIELDS, company);
  const deviceKey = withCompany(DEVICE_KEY_FIELDS, company);
  const register = withCompany(REGISTER_FIELDS, company);
  const resume = withCompany(RESUME_FIELDS, company);
  return { ...shared, validate, deviceKey, register, resume };
}

export type { IRingBodies };
export { buildRingBodies };
