/**
 * Hapoalim app login form bodies, field by field in the order the bank's
 * own app posts them. The app sends the password directly in
 * `credentials` (no portal RSA seal) and identifies the device with
 * `mfp`, the captured RiskMinder device signature.
 */

import type { JsonValueTemplate } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

/** A form body: each field a template. */
type FormShape = Readonly<Record<string, JsonValueTemplate>>;

const EMPTY = { $literal: '' } as const;
const FALSE_TEXT = { $literal: 'false' } as const;
const USER_CODE = { $ref: 'creds.userCode' } as const;
const PASSWORD = { $ref: 'creds.password' } as const;
const ORGANIZATION = { $ref: 'config.secrets.organization' } as const;
const APP_ID = { $ref: 'config.secrets.appId' } as const;
const DEVICE_SIGNATURE = { $ref: 'carry.deviceSignature' } as const;
const KDI = { $ref: 'carry.kdi' } as const;

/** Sends the password with the device signature; no portal seal. */
const VERIFY_FORM: FormShape = {
  organization: ORGANIZATION,
  identifier: USER_CODE,
  credentials: PASSWORD,
  authType: EMPTY,
  flow: { $literal: 'authenticate' },
  state: { $literal: 'LOGON' },
  mfp: DEVICE_SIGNATURE,
  generatedDeviceID: EMPTY,
  openBanking: FALSE_TEXT,
  logintype: EMPTY,
  threadId: EMPTY,
  whatsapp: FALSE_TEXT,
  whatsappIndicator: EMPTY,
  maliciousActive: FALSE_TEXT,
  deviceid: EMPTY,
};

/** Asks the bank to text the code. */
const OTP_INIT_FORM: FormShape = {
  otpchannel: { $literal: 'sms' },
  flow: { $literal: 'authenticate' },
  state: { $literal: 'logonotp' },
  appId: APP_ID,
  target: EMPTY,
  mfp: DEVICE_SIGNATURE,
};

/** Sends the code, echoing the CSRF cookie and the device signature. */
const OTP_VERIFY_FORM: FormShape = {
  appId: APP_ID,
  csrffield: { $ref: 'cookie.csrfcookie' },
  flow: { $literal: 'authenticate' },
  state: { $literal: 'logonotp' },
  otp: { $ref: 'carry.otp' },
  mfp: DEVICE_SIGNATURE,
};

/** Starts the Arcot device download; a new device answers 302 to the step-up. */
const ARCOTID_FORM: FormShape = {
  deviceid: KDI,
  flow: { $literal: 'IMPDEVREG' },
  state: { $literal: 'FINISH' },
  mfp: DEVICE_SIGNATURE,
};

/** Starts the device step-up SMS. */
const STEPUP_INIT_FORM: FormShape = {
  deviceid: KDI,
  flow: { $literal: 'IMPDEVREG' },
  state: { $literal: 'STEPUPOTP' },
  appId: { $literal: 'bankApp2Generationnew' },
  otpchannel: { $literal: 'sms' },
  target: EMPTY,
  organization: ORGANIZATION,
  mfp: DEVICE_SIGNATURE,
};

/** Sends the device step-up code. */
const STEPUP_VERIFY_FORM: FormShape = {
  otp: { $ref: 'carry.stepupOtp' },
  target: { $literal: 'sms' },
  flow: { $literal: 'IMPDEVREG' },
  state: { $literal: 'STEPUPOTP' },
  mfp: DEVICE_SIGNATURE,
};

export {
  ARCOTID_FORM,
  OTP_INIT_FORM,
  OTP_VERIFY_FORM,
  STEPUP_INIT_FORM,
  STEPUP_VERIFY_FORM,
  VERIFY_FORM,
};
