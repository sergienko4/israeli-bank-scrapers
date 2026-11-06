/**
 * Device-memory persistent auth (N48): enrollment runs the configured login
 * flow and publishes the server-issued device id once; a resume seeds the
 * stored id into carry before the same flow and publishes nothing. A state
 * bound to another provider or account fails before any request.
 */

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IDeviceMemoryAuthConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  decodeDeviceMemoryState,
  encodeDeviceMemoryState,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/DeviceMemoryStateCodec.js';
import type { PersistentAuthMode } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import { none } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { failWithDetails, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  type IStateRecorder,
  makeDurableStrategy,
  makeRecorder,
  PEPPER_CTX,
  registerPepperAuthUrls,
} from './DurableAuthFixtures.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const BEARER = 'syn-bearer';
const ENROLLED_DID = 'syn-did-enrolled';
const STORED_DID = 'syn-did-stored';
const OWNER = { provider: 'syn-web', account: 'syn-user' };
const CREDS = { username: 'Syn-User', password: 'syn-pass' };

const BLOCK: IDeviceMemoryAuthConfig = {
  kind: 'device-memory',
  provider: OWNER.provider,
  deviceIdField: 'did',
  accountField: 'username',
};

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  persistentAuth: BLOCK,
  steps: [
    {
      name: 'login',
      urlTag: 'auth.login',
      body: {
        shape: { user: { $ref: 'creds.username' }, did: { $ref: 'carry.did', optional: true } },
      },
      extractsToCarry: { token: '/token' },
      optionalExtractsToCarry: { did: { pointer: '/did' } },
    },
  ],
};

beforeAll((): void => {
  registerPepperAuthUrls();
});

interface IRunInputs {
  readonly response: Readonly<Record<string, string>>;
  readonly stored?: string;
  readonly account?: string;
  readonly recorder?: IStateRecorder;
}

interface IDeviceRun {
  readonly result: Procedure<string>;
  readonly captures: IApiPostCapture[];
  readonly recorder: IStateRecorder;
}

/**
 * Encode a stored device-memory state for an owner.
 * @param deviceId - Stored device id.
 * @param owner - Provider and account the state is bound to.
 * @returns Opaque state.
 */
function storedState(deviceId: string, owner: typeof OWNER = OWNER): string {
  const state = { version: 1, kind: 'device-memory', ...owner, deviceId } as const;
  const encoded = encodeDeviceMemoryState(state, owner);
  if (!encoded.success) throw new TypeError('fixture state must encode');
  return encoded.value;
}

/**
 * A storage callback that always rejects.
 * @returns Never resolves successfully.
 */
async function rejectUpdate(): Promise<void> {
  await Promise.resolve();
  throw new TypeError('syn storage failure');
}

/**
 * The durable mode for one run.
 * @param inputs - Run inputs.
 * @param recorder - State recorder.
 * @returns Enroll without a stored state, else resume.
 */
function modeOf(inputs: IRunInputs, recorder: IStateRecorder): PersistentAuthMode {
  const account = inputs.account ?? CREDS.username;
  const base = { block: BLOCK, onUpdate: recorder.onUpdate, account };
  if (inputs.stored === undefined) return { kind: 'enroll', ...base };
  return { kind: 'resume', ...base, encodedState: inputs.stored };
}

/**
 * Prime a device-memory strategy over one scripted login response.
 * @param inputs - Run inputs.
 * @returns Result, captured requests and recorder.
 */
async function runPrime(inputs: IRunInputs): Promise<IDeviceRun> {
  const captures: IApiPostCapture[] = [];
  const recorder = inputs.recorder ?? makeRecorder();
  const mode = modeOf(inputs, recorder);
  const strategy = makeDurableStrategy(CONFIG, mode);
  const bus = makeStubMediator({ responses: [succeed(inputs.response)], captures });
  const result = await strategy.primeInitial(bus, PEPPER_CTX, CREDS);
  recorder.events.push('returned');
  return { result, captures, recorder };
}

describe('device-memory enrollment', () => {
  it('runs the login flow without a device id and publishes the issued one once', async () => {
    const run = await runPrime({ response: { token: BEARER, did: ENROLLED_DID } });
    expect(run.result).toEqual({ success: true, value: BEARER });
    expect(run.captures[0].body).toEqual({ user: CREDS.username });
    expect(run.recorder.events).toEqual(['published', 'returned']);
    const decoded = decodeDeviceMemoryState(run.recorder.published[0], OWNER);
    expect(decoded).toMatchObject({ success: true, value: { deviceId: ENROLLED_DID } });
  });

  it.each([
    ['no device id', { token: BEARER }],
    ['an invalid device id', { token: BEARER, did: 'syn/did' }],
  ])('fails with %s after the login and publishes nothing', async (_label, response) => {
    const run = await runPrime({ response });
    const errorMessage = 'persistent auth failed: device-id';
    expect(run.result).toMatchObject({ success: false, errorMessage });
    expect(run.recorder.invocations).toHaveLength(0);
  });

  it('fails when the caller cannot store the state', async () => {
    const recorder = { ...makeRecorder(), onUpdate: rejectUpdate };
    const response = { token: BEARER, did: ENROLLED_DID };
    const run = await runPrime({ response, recorder });
    const errorMessage = 'persistent auth failed: callback';
    expect(run.result).toMatchObject({ success: false, errorMessage });
  });
});

describe('device-memory resume', () => {
  it('seeds the stored device id into the login and publishes nothing', async () => {
    const stored = storedState(STORED_DID);
    const run = await runPrime({ response: { token: BEARER }, stored });
    expect(run.result).toEqual({ success: true, value: BEARER });
    expect(run.captures[0].body).toEqual({ user: CREDS.username, did: STORED_DID });
    expect(run.recorder.invocations).toHaveLength(0);
  });

  it.each([
    ['whole', STORED_DID, CREDS.username],
    ['truncated', STORED_DID.slice(0, 7), CREDS.username.slice(0, 3)],
  ])(
    'does not expose a %s stored id or account echoed by a failed answer',
    async (_label, id, account) => {
      const stored = storedState(STORED_DID);
      const message = `${id} rejected ${account}`;
      const run = await runPrime({ response: { message }, stored });
      expect(run.result).toMatchObject({
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: 'persistent auth failed: flow',
      });
      const failure = run.result.success ? '' : run.result.errorMessage;
      expect(failure).not.toContain(id);
      expect(failure).not.toContain(account);
    },
  );

  it('omits bank-controlled WAF details while retaining the refusal type', async () => {
    const stored = storedState(STORED_DID);
    const recorder = makeRecorder();
    const mode = modeOf({ response: {}, stored }, recorder);
    const strategy = makeDurableStrategy(CONFIG, mode);
    const errorType = ScraperErrorTypes.WafBlocked;
    const failure = failWithDetails(errorType, `bank rejected ${STORED_DID}`, {
      provider: 'cloudflare',
      httpStatus: 403,
      pageTitle: STORED_DID,
      pageUrl: `https://bank.example/login?did=${STORED_DID}`,
      responseSnippet: CREDS.username,
      suggestions: [STORED_DID],
    });
    const bus = makeStubMediator({ responses: [failure], captures: [] });
    const result = await strategy.primeInitial(bus, PEPPER_CTX, CREDS);
    const errorDetails = none();
    expect(result).toEqual({
      success: false,
      errorType,
      errorMessage: 'persistent auth failed: flow',
      errorDetails,
    });
    expect(recorder.invocations).toHaveLength(0);
  });

  it('resumes when the username differs only in case', async () => {
    const stored = storedState(STORED_DID);
    const run = await runPrime({ response: { token: BEARER }, stored, account: 'SYN-USER' });
    expect(run.result).toEqual({ success: true, value: BEARER });
  });

  it.each([
    ['another provider', { ...OWNER, provider: 'other-web' }, 'provider'],
    ['another account', { ...OWNER, account: 'other-user' }, 'account'],
  ])('refuses a state bound to %s before any request', async (_label, owner, category) => {
    const stored = storedState(STORED_DID, owner);
    const run = await runPrime({ response: { token: BEARER }, stored });
    const errorMessage = `persistent auth state invalid: ${category}`;
    expect(run.result).toMatchObject({ success: false, errorMessage });
    expect(run.captures).toHaveLength(0);
  });

  it('refuses an in-run renewal with zero requests', async () => {
    const stored = storedState(STORED_DID);
    const recorder = makeRecorder();
    const mode = modeOf({ response: {}, stored }, recorder);
    const strategy = makeDurableStrategy(CONFIG, mode);
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const result = await strategy.primeFresh(bus, PEPPER_CTX, CREDS);
    const errorMessage = 'persistent auth failed: in-run-renewal';
    expect(result).toMatchObject({ success: false, errorMessage });
    expect(captures).toHaveLength(0);
  });
});
