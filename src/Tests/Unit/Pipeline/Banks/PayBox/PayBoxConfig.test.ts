/**
 * Integration test for the PayBox API-direct call-config literal.
 *
 * Pins the bank surface that the mediator consumes: AES-CBC-PKCS7 signer
 * algorithm with body-pointer placement, secrets present, deterministic
 * deviceId derivation via sha256-prefix-16, 3-step login chain with
 * cryptoField hooks, warm-start handoff via creds.otpLongTermToken.
 *
 * Per `c:\tmp\guidelines\test-guidlines.md` ("integration test over
 * unit test, unit test for edge cases only") this single test pins the
 * data-only contract — any drift surfaces here BEFORE a real PayBox
 * run notices the regression.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's
 * test architectural rule (Pipeline tests don't statically import
 * from Registry/Config — same pattern as
 * `WaveOBranchGaps.test.ts:PipelineBankConfig guard`).
 */

import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';

const CALL_PATH = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPayBox.js';
const CRYPTO_PATH =
  '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPayBoxCrypto.js';
const STEPS_PATH =
  '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPayBoxSteps.js';

/** Module shape returned by the dynamic call-config import. */
interface ICallModule {
  readonly PAYBOX_API_DIRECT_CALL: IApiDirectCallConfig;
}

/** Module shape returned by the dynamic crypto-config import. */
interface ICryptoModule {
  readonly PAYBOX_LOGIN_SIGNER: IApiDirectCallConfig['signer'];
  readonly PAYBOX_SCRAPE_SIGNER: IApiDirectCallConfig['signer'];
  readonly PAYBOX_SECRETS: Readonly<Record<string, string>>;
  readonly SIGN_KEY: string;
  readonly PIN_SUFFIX: string;
}

/** Module shape returned by the dynamic steps import. */
interface IStepsModule {
  readonly PHONE_VALIDATE_STEP: IApiDirectCallConfig['steps'][number];
  readonly PIN_VALIDATION_STEP: IApiDirectCallConfig['steps'][number];
  readonly LOGIN_BY_SMS_STEP: IApiDirectCallConfig['steps'][number];
}

/**
 * Load the PayBox call-config module via the project's permitted
 * dynamic-import escape hatch.
 * @returns Promise resolving to the call module.
 */
async function loadCall(): Promise<ICallModule> {
  const mod = (await import(CALL_PATH)) as ICallModule;
  return mod;
}

/**
 * Load the PayBox crypto-config module via dynamic import.
 * @returns Promise resolving to the crypto module.
 */
async function loadCrypto(): Promise<ICryptoModule> {
  const mod = (await import(CRYPTO_PATH)) as ICryptoModule;
  return mod;
}

/**
 * Load the PayBox steps module via dynamic import.
 * @returns Promise resolving to the steps module.
 */
async function loadSteps(): Promise<IStepsModule> {
  const mod = (await import(STEPS_PATH)) as IStepsModule;
  return mod;
}

describe('PAYBOX_API_DIRECT_CALL — flow shape', () => {
  it('declares flow=sms-otp with raw authScheme', async () => {
    const mod = await loadCall();
    expect(mod.PAYBOX_API_DIRECT_CALL.flow).toBe('sms-otp');
    expect(mod.PAYBOX_API_DIRECT_CALL.authScheme).toBe('raw');
  });

  it('configures warm-start via otpLongTermToken → token', async () => {
    const mod = await loadCall();
    expect(mod.PAYBOX_API_DIRECT_CALL.warmStart).toEqual({
      credsField: 'otpLongTermToken',
      carryField: 'token',
      fromStepIndex: 3,
    });
  });

  it('configures jwtClaims freshness gate (60s skew)', async () => {
    const mod = await loadCall();
    expect(mod.PAYBOX_API_DIRECT_CALL.jwtClaims).toEqual({
      freshnessField: 'exp',
      skewSeconds: 60,
    });
  });

  it('omits probe — customer step is the smoke test', async () => {
    const mod = await loadCall();
    expect(mod.PAYBOX_API_DIRECT_CALL.probe).toBeUndefined();
  });

  it('seeds deviceId16Hex via sha256-prefix-16 + uId via jwt-claim', async () => {
    const mod = await loadCall();
    const seed = mod.PAYBOX_API_DIRECT_CALL.seedCarryFromCreds;
    expect(seed).toHaveLength(2);
    expect((seed ?? [])[0]).toEqual({
      field: 'deviceId16Hex',
      bootstrap: { kind: 'sha256-prefix-16', from: 'phoneNumber' },
    });
    expect((seed ?? [])[1]).toEqual({
      field: 'uId',
      bootstrap: { kind: 'jwt-claim', from: 'otpLongTermToken', claim: 'pl.uId' },
    });
  });

  it('derives otpKey from deviceId16Hex + pinSuffix, truncated to 32 bytes', async () => {
    const mod = await loadCall();
    const derived = mod.PAYBOX_API_DIRECT_CALL.derivedCarry;
    expect(derived).toHaveLength(1);
    const head = (derived ?? [])[0];
    expect(head).toEqual({
      into: 'otpKey',
      parts: ['carry.deviceId16Hex', 'config.secrets.pinSuffix'],
      separator: '|',
      truncateBytes: 32,
    });
  });

  it('runs 3 login steps in order', async () => {
    const call = await loadCall();
    const steps = await loadSteps();
    expect(call.PAYBOX_API_DIRECT_CALL.steps).toHaveLength(3);
    expect(call.PAYBOX_API_DIRECT_CALL.steps[0]).toBe(steps.PHONE_VALIDATE_STEP);
    expect(call.PAYBOX_API_DIRECT_CALL.steps[1]).toBe(steps.PIN_VALIDATION_STEP);
    expect(call.PAYBOX_API_DIRECT_CALL.steps[2]).toBe(steps.LOGIN_BY_SMS_STEP);
  });

  it('login signer = AES-CBC-PKCS7 with body-pointer at /signature', async () => {
    const call = await loadCall();
    const crypto = await loadCrypto();
    expect(call.PAYBOX_API_DIRECT_CALL.signer).toBe(crypto.PAYBOX_LOGIN_SIGNER);
    const signer = crypto.PAYBOX_LOGIN_SIGNER;
    expect(signer?.algorithm).toBe('AES-CBC-PKCS7');
    if (signer?.algorithm === 'AES-CBC-PKCS7') {
      expect(signer.bodySignatureField).toBe('/signature');
      expect(signer.outputPostfix).toBe('\n');
    }
  });

  it('scrape signer body-pointer = /auth/signature', async () => {
    const crypto = await loadCrypto();
    const signer = crypto.PAYBOX_SCRAPE_SIGNER;
    expect(signer?.algorithm).toBe('AES-CBC-PKCS7');
    if (signer?.algorithm === 'AES-CBC-PKCS7') {
      expect(signer.bodySignatureField).toBe('/auth/signature');
      expect(signer.outputPostfix).toBe('\n');
    }
  });

  it('canonical-string parts are tsMs|deviceId for both signers', async () => {
    const crypto = await loadCrypto();
    const signers = [crypto.PAYBOX_LOGIN_SIGNER, crypto.PAYBOX_SCRAPE_SIGNER];
    for (const signer of signers) {
      expect(signer?.canonical.parts).toEqual(['tsMs', 'deviceId']);
      expect(signer?.canonical.separator).toBe('|');
    }
  });

  it('publishes signKey + pinSuffix in the public secrets block', async () => {
    const crypto = await loadCrypto();
    expect(crypto.PAYBOX_SECRETS.signKey).toBe(crypto.SIGN_KEY);
    expect(crypto.PAYBOX_SECRETS.pinSuffix).toBe(crypto.PIN_SUFFIX);
    expect(crypto.SIGN_KEY).toHaveLength(32);
    expect(crypto.PIN_SUFFIX).toHaveLength(32);
  });
});

describe('PAYBOX login steps', () => {
  it('phoneValidate step hits /phoneValidate + extracts accessToken1', async () => {
    const steps = await loadSteps();
    const step = steps.PHONE_VALIDATE_STEP;
    expect(step.urlTag).toBe('identity.phoneValidate');
    expect(step.extractsToCarry.accessToken1).toBe('/content/access_token');
    expect(step.preHook).toBeUndefined();
  });

  it('pinValidation step encrypts OTP into /pin + extracts accessToken2', async () => {
    const steps = await loadSteps();
    const step = steps.PIN_VALIDATION_STEP;
    expect(step.urlTag).toBe('identity.pinValidation');
    expect(step.extractsToCarry.accessToken2).toBe('/content/access_token');
    const hook = step.preHook;
    expect(hook?.awaitCredsField).toBe('otpCodeRetriever');
    expect(hook?.intoCarryField).toBe('otpDigitsPlain');
    const crypto = hook?.cryptoField;
    expect(crypto?.writeTo).toBe('/pin');
    expect(crypto?.ivRef).toBe('carry.pinIv1');
    expect(crypto?.outputPostfix).toBe('\n');
  });

  it('loginBySms step uses pinIv2 + extracts token + uId', async () => {
    const steps = await loadSteps();
    const step = steps.LOGIN_BY_SMS_STEP;
    expect(step.urlTag).toBe('identity.loginBySms');
    expect(step.extractsToCarry.token).toBe('/content/access_token');
    expect(step.extractsToCarry.uId).toBe('/content/uId');
    expect(step.preHook?.cryptoField?.ivRef).toBe('carry.pinIv2');
  });
});

describe('PAYBOX static headers', () => {
  it('declares okhttp UA + JSON content-type + gzip accept-encoding', async () => {
    const mod = await loadCall();
    const headers = mod.PAYBOX_API_DIRECT_CALL.staticHeaders;
    expect(headers).toBeDefined();
    expect(headers?.['User-Agent']).toBe('okhttp/4.12.0');
    expect(headers?.['Content-Type']).toBe('application/json; charset=UTF-8');
    expect(headers?.['Accept-Encoding']).toBe('gzip');
  });
});
