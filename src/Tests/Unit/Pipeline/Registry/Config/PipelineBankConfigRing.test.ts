/**
 * Ring login config — the wire format the gateway accepts and the
 * invariants the login flow relies on, checked on every issuer instance.
 * The issuers share one protocol; only the values in {@link ISSUERS} differ.
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

const CONFIG_DIR = '../../../../../Scrapers/Pipeline/Registry/Config/';

/** The bank's headless block, as the build-time validator reads it. */
type IHeadlessUrlsConfig = Exclude<IApiDirectRuleInput['headless'], false>;

/** One ring issuer: where its config lives and the values a live login proved. */
interface IRingIssuer {
  readonly bank: string;
  readonly module: string;
  readonly headlessExport: string;
  readonly origin: string;
  readonly applicationId: string;
  readonly isrdomain: string;
  readonly companyCode: string;
}

const ISSUERS: readonly IRingIssuer[] = [
  {
    bank: 'Isracard',
    module: 'PipelineBankConfigIsracard.js',
    headlessExport: 'ISRACARD_HEADLESS',
    origin: 'https://ring.isracard.co.il',
    applicationId: 'mi',
    isrdomain: 'isracard',
    companyCode: '11',
  },
  {
    bank: 'Amex',
    module: 'PipelineBankConfigAmex.js',
    headlessExport: 'AMEX_HEADLESS',
    origin: 'https://ring.americanexpress.co.il',
    applicationId: 'ma',
    isrdomain: 'amex',
    companyCode: '77',
  },
];

/** An issuer's login config and headless block. */
interface IRingModule {
  readonly call: IApiDirectCallConfig;
  readonly headless: IHeadlessUrlsConfig;
}

const CREDS = { id: '012345678', card6Digits: '123456', password: 'pw' } as const;
const CARRY = { userName: 'U1', bcKey: 'BC', udid: 'UD', key: 'K' } as const;

/**
 * What a live login sent at each step, for the values above.
 * @param companyCode - The issuer's company code.
 * @returns Body per step name.
 */
function expectedBodies(companyCode: string): Readonly<Record<string, JsonValue>> {
  return {
    validate: {
      id: CREDS.id,
      idType: '1',
      cardSuffix: CREDS.card6Digits,
      countryCode: '212',
      companyCode,
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
      companyCode,
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
      companyCode,
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
      companyCode,
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
}

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
 * Load an issuer's config module.
 * @param issuer - The issuer.
 * @returns Its login config and headless block.
 */
async function loadModule(issuer: IRingIssuer): Promise<IRingModule> {
  const loaded = (await import(`${CONFIG_DIR}${issuer.module}`)) as Record<string, unknown>;
  const call = loaded.default as IApiDirectCallConfig;
  const headless = loaded[issuer.headlessExport] as IHeadlessUrlsConfig;
  return { call, headless };
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

describe.each(ISSUERS)('ring login config — $bank', issuer => {
  it('passes the build-time validator with its headless block', async () => {
    const { call, headless } = await loadModule(issuer);
    const result = validateApiDirectConfig({ call, headless });
    expect(result).toEqual({ success: true, value: true });
  });

  it('sends each body exactly as a live login did', async () => {
    const { call } = await loadModule(issuer);
    for (const step of call.steps) {
      const body = hydrateFixed(step.body?.shape ?? {}, call);
      expect(body).toEqual(expectedBodies(issuer.companyCode)[step.name]);
    }
  });

  it('posts every step to the service URL, naming its bank service', async () => {
    const { call } = await loadModule(issuer);
    const queries = call.steps.map(step => hydrateFixed(step.queryTemplate ?? {}, call));
    const { applicationId } = issuer;
    const expected = EXPECTED_SERVICES.map(serviceName => ({ serviceName, applicationId }));
    expect(queries).toEqual(expected);
    const tags = new Set(call.steps.map(step => step.urlTag));
    expect([...tags]).toEqual(['auth.service']);
  });

  it('starts the warm path at the key sign-in, which reads the stored key', async () => {
    const { call } = await loadModule(issuer);
    const warm = call.warmStart;
    const entry = call.steps[warm?.fromStepIndex ?? -1];
    expect(warm).toMatchObject({ fromStepIndex: 4, carryField: 'key', validation: 'bank-call' });
    expect(entry.name).toBe('resume');
    expect(entry.body?.shape).toMatchObject({ key: { $ref: 'carry.key' } });
  });

  it('maps a rejected ID or password to a credential error, and nothing later', async () => {
    const { call } = await loadModule(issuer);
    const [validate, login, ...later] = call.steps.map(step => step.outcome);
    expect(validate?.failureMap).toEqual({ '4': ScraperErrorTypes.ChangePassword });
    expect(validate?.defaultFailure).toBe(ScraperErrorTypes.InvalidPassword);
    expect(login?.failureMap).toEqual({ '3': ScraperErrorTypes.ChangePassword });
    expect(login?.defaultFailure).toBe(ScraperErrorTypes.InvalidPassword);
    const laterDefaults = later.map(outcome => outcome?.defaultFailure);
    expect(new Set(laterDefaults)).toEqual(new Set([ScraperErrorTypes.Generic]));
  });

  it('derives a stable device id from the ID number and starts with no user code', async () => {
    const { call } = await loadModule(issuer);
    const first = buildInitialCarry(call, CREDS, {});
    const second = buildInitialCarry(call, CREDS, {});
    const udid = createHash('sha256').update(CREDS.id, 'utf8').digest('hex').slice(0, 16);
    expect(first).toMatchObject({ success: true, value: { udid, userName: '' } });
    expect(second).toMatchObject({ success: true, value: { udid } });
    const isFreshKey = isOk(first) && isOk(second) && first.value.bcKey !== second.value.bcKey;
    expect(isFreshKey).toBe(true);
  });

  it('sends lowercase headers, plus the session key and a fresh trace id per call', async () => {
    const { call } = await loadModule(issuer);
    const names = Object.keys(call.staticHeaders ?? {});
    const lowered = names.map(name => name.toLowerCase());
    expect(names).toEqual(lowered);
    expect(call.staticHeaders).toMatchObject({ isrdomain: issuer.isrdomain, platform: 'mobile' });
    const perCall = { bckey: { $ref: 'carry.bcKey' }, traceidentifier: { $ref: 'uuid' } };
    for (const step of call.steps) expect(step.headers).toEqual(perCall);
  });

  it('requires the ID, six card digits and password before any call', async () => {
    const { call } = await loadModule(issuer);
    const required = { id: 'digits', card6Digits: 'sixDigits', password: 'nonEmpty' };
    expect(call.requiredCreds).toEqual(required);
  });

  it('runs over native fetch, with the session on cookies rather than a header', async () => {
    const { call, headless } = await loadModule(issuer);
    expect(call.authScheme).toBe('none');
    expect(headless).toMatchObject({ nativeFetch: true, sessionCookies: true });
    expect(headless.paths).toEqual({ 'auth.service': `${issuer.origin}/service` });
  });
});
