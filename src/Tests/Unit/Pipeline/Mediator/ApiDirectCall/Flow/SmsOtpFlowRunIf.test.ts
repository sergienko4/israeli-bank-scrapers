/**
 * Conditional steps. A step whose `runIf` guard names a carry slot runs
 * only when that slot holds text matching one of `oneOf`, compared without
 * case. A false guard, or a slot that is missing or not text, skips the step
 * and its pre-hook: no request is sent and no OTP is asked for.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/SmsOtpFlow.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import { WARM_STEP_TAG } from './WarmStartFixtures.js';

const HINT = CompanyTypes.OneZero;
const STEP_URL = 'https://bank.example/authenticate/verify';

/** The bind step: reads the bank's `state` and a first token. */
const BIND_STEP: IStepConfig = {
  name: 'bind',
  urlTag: WARM_STEP_TAG,
  body: { shape: {} },
  extractsToCarry: { token: '/token' },
  optionalExtractsToCarry: { state: { pointer: '/state' } },
};

/** The OTP step: runs only while the bank asks for a code. */
const OTP_STEP: IStepConfig = {
  name: 'login',
  urlTag: WARM_STEP_TAG,
  body: { shape: { otp: { $ref: 'carry.otp' } } },
  extractsToCarry: { token: '/token' },
  preHook: { awaitCredsField: 'otpCodeRetriever', intoCarryField: 'otp' },
  runIf: { carry: 'state', oneOf: ['LogonOTP'] },
};

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  steps: [BIND_STEP, OTP_STEP],
};

/** What one run of the two-step flow did. */
interface IRunTrace {
  readonly result: unknown;
  readonly captures: IApiPostCapture[];
  readonly calls: number;
}

/**
 * Run the two-step flow with a counting OTP retriever.
 * @param bindAnswer - The bind step's answer.
 * @returns The flow result, the requests sent and the retriever calls.
 */
async function runWith(bindAnswer: JsonValue): Promise<IRunTrace> {
  const captures: IApiPostCapture[] = [];
  const responses = [succeed(bindAnswer), succeed({ token: 'otp-token' })];
  const bus = makeStubMediator({ responses, captures });
  let calls = 0;
  /**
   * Count the call and deliver a code.
   * @returns The delivered code.
   */
  const otpCodeRetriever = (): Promise<string> => {
    calls += 1;
    return Promise.resolve('12345');
  };
  const creds = { otpCodeRetriever };
  const result = await runSmsOtpFlow({ config: CONFIG, bus, creds, companyId: HINT });
  return { result, captures, calls };
}

describe('SmsOtpFlow — runIf', () => {
  beforeAll((): void => {
    registerWkUrl(WARM_STEP_TAG, HINT, STEP_URL);
  });

  it.each<[string, string]>([
    ['the same case', 'LogonOTP'],
    ['another case', 'logonotp'],
  ])('runs the step and its pre-hook when the guard matches in %s', async (_label, state) => {
    const run = await runWith({ token: 'bind-token', state });
    expect(run.result).toMatchObject({ success: true });
    expect(run.calls).toBe(1);
    expect(run.captures).toHaveLength(2);
    expect(run.captures[1].body).toEqual({ otp: '12345' });
  });

  it.each<[string, JsonValue]>([
    ['a state outside oneOf', { token: 'bind-token', state: 'landpage' }],
    ['a missing state', { token: 'bind-token' }],
    ['a state that is not text', { token: 'bind-token', state: { code: 'LogonOTP' } }],
  ])('skips the step and its pre-hook for %s', async (_label, bindAnswer) => {
    const run = await runWith(bindAnswer);
    expect(run.result).toMatchObject({ success: true });
    expect(run.calls).toBe(0);
    expect(run.captures).toHaveLength(1);
  });
});
