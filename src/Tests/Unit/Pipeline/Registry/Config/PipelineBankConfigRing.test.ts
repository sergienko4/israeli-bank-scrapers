/**
 * Ring login config — the wire format the gateway accepts and the
 * invariants the login flow relies on, checked on the Isracard instance.
 *
 * Bodies and query strings are hydrated through the real template engine
 * and compared with the field sets a live login proved, so a template slip
 * (a literal where a ref belongs, a missing field) fails here, not at the
 * bank.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's test rule
 * (Pipeline tests don't statically import from Registry/Config).
 */

import { createHash } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  JsonValueTemplate,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { buildInitialCarry } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/FlowInitCarry.build.js';
import { hydrate } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const CONFIG_PATH =
  '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigIsracard.js';

/** The bank's headless block, as the build-time validator reads it. */
type IHeadlessUrlsConfig = Exclude<IApiDirectRuleInput['headless'], false>;

/** The Isracard instance module. */
interface IIsracardModule {
  readonly default: IApiDirectCallConfig;
  readonly ISRACARD_HEADLESS: IHeadlessUrlsConfig;
}

const CREDS = { id: '012345678', card6Digits: '123456', password: 'pw' } as const;
const CARRY = { userName: 'U1', bcKey: 'BC', udid: 'UD', key: 'K' } as const;

/** What a live login sent at each step, for the values above. */
const EXPECTED_BODIES: Readonly<Record<string, JsonValue>> = {
  validate: {
    id: CREDS.id,
    idType: '1',
    cardSuffix: CREDS.card6Digits,
    countryCode: '212',
    companyCode: '11',
    checkLevel: '1',
    returnMessage: 'true',
    reqName: 'ValidateIdDataNoReg',
    loginTypeId: '1',
  },
  login: {
    MisparZihuy: CREDS.id,
    KodMishtamesh: CARRY.userName,
    Sisma: CREDS.password,
    KodZihuy: '1',
    KodEretz: '212',
    returnMessage: 'true',
    ap: 'MisparZihuy',
    reqName: 'performNewLogon',
    bcKey: CARRY.bcKey,
  },
  deviceKey: {
    reqName: 'CustomerValidateKeyOtp',
    companyCode: '11',
    applicationSource: '1',
    returnMessage: 'true',
    checkLevel: '9',
    MAC: '1',
    UDID: CARRY.udid,
    ARRAY: '0',
    idType: '1',
    countryCode: '212',
    idNumber: CREDS.id,
    cardSuffix: CREDS.card6Digits,
  },
  register: {
    reqName: 'CustomerDataRegistration',
    idNumber: CREDS.id,
    idType: '1',
    countryCode: '212',
    companyCode: '11',
    activityType: '1',
    applicationSource: '1',
    defaultIdMethod: '1',
    entryMethod: '1',
    key: CARRY.key,
    UDID: CARRY.udid,
    MAC: '1',
    ARRAY: '0',
    returnMessage: 'true',
  },
  resume: {
    reqName: 'CustomerValidateKeyOtp',
    companyCode: '11',
    applicationSource: '1',
    returnMessage: 'true',
    checkLevel: '4',
    idMethod: '1',
    key: CARRY.key,
    MAC: '1',
    UDID: CARRY.udid,
    ARRAY: '0',
  },
  sessionToken: {
    reqName: 'performLogonOtp',
    MisparZihuy: CREDS.id,
    KodZihuy: '1',
    KodEretz: '212',
    countryCode: '212',
    KodMedina: '212',
    KodMishtamesh: CARRY.userName,
    otpSMS: false,
    returnMessage: 'true',
    ap: 'MisparZihuy',
    paymentAppInstanceId: '',
    walletId: '216',
  },
};

/** The bank service each step names, in step order. */
const EXPECTED_SERVICES = [
  'ValidateIdDataNoReg',
  'performNewLogon',
  'CustomerValidateKeyOtp',
  'CustomerDataRegistration',
  'CustomerValidateKeyOtp',
  'performLogonOtp',
];

/**
 * Load the Isracard instance module.
 * @returns The module.
 */
async function loadModule(): Promise<IIsracardModule> {
  return (await import(CONFIG_PATH)) as IIsracardModule;
}

/**
 * Hydrate a template with the fixed creds and carry above.
 * @param template - Body or query template.
 * @param config - The config the template belongs to.
 * @returns The hydrated value; fails the test when hydration fails.
 */
function hydrateFixed(template: JsonValueTemplate, config: IApiDirectCallConfig): JsonValue {
  const result = hydrate(template, { carry: CARRY, creds: CREDS, config });
  if (!isOk(result)) throw new TypeError(result.errorMessage);
  return result.value;
}

describe('ring login config — Isracard', () => {
  it('passes the build-time validator with its headless block', async () => {
    const { default: call, ISRACARD_HEADLESS: headless } = await loadModule();
    const result = validateApiDirectConfig({ call, headless });
    expect(result).toEqual({ success: true, value: true });
  });

  it('sends each body exactly as a live login did', async () => {
    const { default: call } = await loadModule();
    for (const step of call.steps) {
      const body = hydrateFixed(step.body?.shape ?? {}, call);
      expect(body).toEqual(EXPECTED_BODIES[step.name]);
    }
  });

  it('posts every step to the service URL, naming its bank service', async () => {
    const { default: call } = await loadModule();
    const queries = call.steps.map(step => hydrateFixed(step.queryTemplate ?? {}, call));
    const expected = EXPECTED_SERVICES.map(serviceName => ({ serviceName, applicationId: 'mi' }));
    expect(queries).toEqual(expected);
    const tags = new Set(call.steps.map(step => step.urlTag));
    expect([...tags]).toEqual(['auth.service']);
  });

  it('starts the warm path at the key sign-in, which reads the stored key', async () => {
    const { default: call } = await loadModule();
    const warm = call.warmStart;
    const entry = call.steps[warm?.fromStepIndex ?? -1];
    expect(warm).toMatchObject({ fromStepIndex: 4, carryField: 'key', validation: 'bank-call' });
    expect(entry.name).toBe('resume');
    expect(entry.body?.shape).toMatchObject({ key: { $ref: 'carry.key' } });
  });

  it('maps a rejected ID or password to a credential error, and nothing later', async () => {
    const { default: call } = await loadModule();
    const [validate, login, ...later] = call.steps.map(step => step.outcome);
    expect(validate?.failureMap).toEqual({ '4': ScraperErrorTypes.ChangePassword });
    expect(validate?.defaultFailure).toBe(ScraperErrorTypes.InvalidPassword);
    expect(login?.failureMap).toEqual({ '3': ScraperErrorTypes.ChangePassword });
    expect(login?.defaultFailure).toBe(ScraperErrorTypes.InvalidPassword);
    const laterDefaults = later.map(outcome => outcome?.defaultFailure);
    expect(new Set(laterDefaults)).toEqual(new Set([ScraperErrorTypes.Generic]));
  });

  it('derives a stable device id from the ID number and starts with no user code', async () => {
    const { default: call } = await loadModule();
    const first = buildInitialCarry(call, CREDS, {});
    const second = buildInitialCarry(call, CREDS, {});
    const udid = createHash('sha256').update(CREDS.id, 'utf8').digest('hex').slice(0, 16);
    expect(first).toMatchObject({ success: true, value: { udid, userName: '' } });
    expect(second).toMatchObject({ success: true, value: { udid } });
    const isFreshKey = isOk(first) && isOk(second) && first.value.bcKey !== second.value.bcKey;
    expect(isFreshKey).toBe(true);
  });

  it('sends lowercase headers, plus the session key and a fresh trace id per call', async () => {
    const { default: call } = await loadModule();
    const names = Object.keys(call.staticHeaders ?? {});
    const lowered = names.map(name => name.toLowerCase());
    expect(names).toEqual(lowered);
    expect(call.staticHeaders).toMatchObject({ isrdomain: 'isracard', platform: 'mobile' });
    const perCall = { bckey: { $ref: 'carry.bcKey' }, traceidentifier: { $ref: 'uuid' } };
    for (const step of call.steps) expect(step.headers).toEqual(perCall);
  });

  it('requires the ID, six card digits and password before any call', async () => {
    const { default: call } = await loadModule();
    const required = { id: 'digits', card6Digits: 'sixDigits', password: 'nonEmpty' };
    expect(call.requiredCreds).toEqual(required);
  });

  it('runs over native fetch, with the session on cookies rather than a header', async () => {
    const { default: call, ISRACARD_HEADLESS: headless } = await loadModule();
    expect(call.authScheme).toBe('none');
    expect(headless).toMatchObject({ nativeFetch: true, sessionCookies: true });
    expect(headless.paths).toEqual({ 'auth.service': 'https://ring.isracard.co.il/service' });
  });
});
