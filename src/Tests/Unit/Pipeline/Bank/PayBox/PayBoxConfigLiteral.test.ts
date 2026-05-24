/**
 * PAYBOX_API_DIRECT_CALL config literal tests — covers UC-PCL-1..3
 * per test.txt §1. Asserts the literal satisfies IApiDirectCallConfig
 * at compile time (tsc), the SIGN_KEY toggle picks the real-device
 * default, and the OTP-bearing steps carry the cryptoField preHook.
 *
 * Config literals are reached via dynamic import inside each test
 * to honour the ESLint `**\/Registry/Config/**` restriction. Local
 * loader helpers cast the dynamic-import return into the typed
 * module shape so the assertions remain strongly typed.
 */

import type { IPayBoxCreds } from '../../../../../Scrapers/Pipeline/Banks/PayBox/PayBoxCreds.js';
import { isPayBoxWarmCreds } from '../../../../../Scrapers/Pipeline/Banks/PayBox/PayBoxCreds.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';

/** Shape of the dynamically-loaded PipelineBankConfigPayBox module. */
interface IPayBoxCallModule {
  readonly PAYBOX_API_DIRECT_CALL: IApiDirectCallConfig;
}

/** Shape of the dynamically-loaded PipelineBankConfigPayBoxCrypto module. */
interface IPayBoxCryptoModule {
  readonly SIGN_KEY: string;
  readonly SIGN_KEY_REAL_DEVICE: string;
  readonly SIGN_KEY_EMULATOR_OR_FLAG: string;
  readonly PIN_SUFFIX: string;
  readonly PHONE_KEY_SUFFIX: string;
  readonly isUseRealDeviceKey: boolean;
  readonly resolveSignKey: (useRealDevice: boolean) => string;
}

/** Shape of the dynamically-loaded PipelineBankConfigPayBoxSteps module. */
interface IPayBoxStepsModule {
  readonly PHONE_VALIDATE_STEP: IStepConfig;
  readonly PIN_VALIDATION_STEP: IStepConfig;
  readonly LOGIN_BY_SMS_STEP: IStepConfig;
}

/**
 * Load PipelineBankConfigPayBox.ts via dynamic import.
 *
 * @returns The typed module exports.
 */
async function loadCallModule(): Promise<IPayBoxCallModule> {
  const mod: unknown =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPayBox.js');
  return mod as IPayBoxCallModule;
}

/**
 * Load PipelineBankConfigPayBoxCrypto.ts via dynamic import.
 *
 * @returns The typed module exports.
 */
async function loadCryptoModule(): Promise<IPayBoxCryptoModule> {
  const mod: unknown =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPayBoxCrypto.js');
  return mod as IPayBoxCryptoModule;
}

/**
 * Load PipelineBankConfigPayBoxSteps.ts via dynamic import.
 *
 * @returns The typed module exports.
 */
async function loadStepsModule(): Promise<IPayBoxStepsModule> {
  const mod: unknown =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPayBoxSteps.js');
  return mod as IPayBoxStepsModule;
}

describe('PAYBOX_API_DIRECT_CALL (UC-PCL-1)', () => {
  it('declares flow=sms-otp + 3 steps + AES signer', async () => {
    const callModule = await loadCallModule();
    const call = callModule.PAYBOX_API_DIRECT_CALL;
    expect(call.flow).toBe('sms-otp');
    expect(call.steps).toHaveLength(3);
    expect(call.signer?.algorithm).toBe('AES-CBC-PKCS7');
  });

  it('warmStart targets otpLongTermToken with fromStepIndex=3', async () => {
    const callModule = await loadCallModule();
    const call = callModule.PAYBOX_API_DIRECT_CALL;
    expect(call.warmStart?.credsField).toBe('otpLongTermToken');
    expect(call.warmStart?.carryField).toBe('token');
    expect(call.warmStart?.fromStepIndex).toBe(3);
  });

  it('probe routes to data.getUserHistory urlTag', async () => {
    const callModule = await loadCallModule();
    expect(callModule.PAYBOX_API_DIRECT_CALL.probe.urlTag).toBe('data.getUserHistory');
  });

  it('signer outputPostfix is newline per spec.txt §4.2', async () => {
    const callModule = await loadCallModule();
    const { signer } = callModule.PAYBOX_API_DIRECT_CALL;
    if (signer?.algorithm === 'AES-CBC-PKCS7') {
      expect(signer.outputPostfix).toBe('\n');
      expect(signer.bodySignatureField).toBe('/signature');
      expect(signer.keyRef).toBe('config.secrets.signKey');
    }
  });
});

describe('SIGN_KEY toggle (UC-PCL-2)', () => {
  it('defaults to emulator-or-flag key per D-9 mitigation (live-server-verified)', async () => {
    const crypto = await loadCryptoModule();
    expect(crypto.isUseRealDeviceKey).toBe(false);
    expect(crypto.SIGN_KEY).toBe(crypto.SIGN_KEY_EMULATOR_OR_FLAG);
  });

  it('exposes both literal candidates exactly 32 chars long', async () => {
    const crypto = await loadCryptoModule();
    expect(crypto.SIGN_KEY_REAL_DEVICE).toHaveLength(32);
    expect(crypto.SIGN_KEY_EMULATOR_OR_FLAG).toHaveLength(32);
  });

  it('SIGN_KEY_REAL_DEVICE matches spec.txt §4.2 literal', async () => {
    const crypto = await loadCryptoModule();
    expect(crypto.SIGN_KEY_REAL_DEVICE).toBe('^492wkd#x12jk4%^SewAk56zx3@xdcf5');
  });

  it('PIN_SUFFIX matches spec.txt §4.3 literal', async () => {
    const crypto = await loadCryptoModule();
    expect(crypto.PIN_SUFFIX).toBe('|<>?xdo34^mnbjh(54hnaGqaOgndsYTa');
    expect(crypto.PIN_SUFFIX).toHaveLength(32);
  });

  it('resolveSignKey returns real-device literal when toggle is true', async () => {
    const crypto = await loadCryptoModule();
    const key = crypto.resolveSignKey(true);
    expect(key).toBe(crypto.SIGN_KEY_REAL_DEVICE);
  });

  it('resolveSignKey returns emulator literal when toggle is false', async () => {
    const crypto = await loadCryptoModule();
    const key = crypto.resolveSignKey(false);
    expect(key).toBe(crypto.SIGN_KEY_EMULATOR_OR_FLAG);
  });
});

describe('PayBox login steps (UC-PCL-3)', () => {
  it('PHONE_VALIDATE_STEP has no preHook', async () => {
    const steps = await loadStepsModule();
    expect(steps.PHONE_VALIDATE_STEP.preHook).toBeUndefined();
  });

  it('PIN_VALIDATION_STEP carries cryptoField preHook', async () => {
    const steps = await loadStepsModule();
    const step = steps.PIN_VALIDATION_STEP;
    expect(step.preHook?.awaitCredsField).toBe('otpCodeRetriever');
    expect(step.preHook?.cryptoField?.writeTo).toBe('/pin');
    expect(step.preHook?.cryptoField?.scrubFromCarry).toBe('otpDigitsPlain');
  });

  it('LOGIN_BY_SMS_STEP carries cryptoField preHook + extracts uId', async () => {
    const steps = await loadStepsModule();
    const step = steps.LOGIN_BY_SMS_STEP;
    expect(step.preHook?.cryptoField?.writeTo).toBe('/pin');
    expect(step.extractsToCarry.token).toBe('/access_token');
    expect(step.extractsToCarry.uId).toBe('/uId');
  });

  it('all three steps target the expected WK url tags', async () => {
    const steps = await loadStepsModule();
    expect(steps.PHONE_VALIDATE_STEP.urlTag).toBe('identity.phoneValidate');
    expect(steps.PIN_VALIDATION_STEP.urlTag).toBe('identity.pinValidation');
    expect(steps.LOGIN_BY_SMS_STEP.urlTag).toBe('identity.loginBySms');
  });
});

describe('IPayBoxCreds discriminator', () => {
  it('isPayBoxWarmCreds returns true on warm variant', () => {
    const warm = {
      phoneNumber: '972-fixt',
      otpLongTermToken: 'fixt-jwt',
      deviceId16Hex: '1083f31199640c1f',
    } as unknown as IPayBoxCreds;
    const isWarm = isPayBoxWarmCreds(warm);
    expect(isWarm).toBe(true);
  });

  it('isPayBoxWarmCreds returns false on cold variant', () => {
    const cold = {
      phoneNumber: '972-fixt',
      otpCodeRetriever: stubOtpRetriever,
    } as unknown as IPayBoxCreds;
    const isWarm = isPayBoxWarmCreds(cold);
    expect(isWarm).toBe(false);
  });
});

/**
 * Synthetic OTP retriever used by the cold-creds discriminator test.
 *
 * @returns A resolved synthetic 4-digit OTP.
 */
function stubOtpRetriever(): Promise<string> {
  return Promise.resolve('9255');
}
