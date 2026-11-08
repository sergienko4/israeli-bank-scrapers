/**
 * Leumi's encrypted login admits only the observed password flow.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IPostStep,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { classifyAnswer } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.classify.js';
import { guardBankError } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.failIfPresent.js';
import { hydrate } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';

const MODULE =
  '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigLeumiTransmit.js';
const CONFIG: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [] };
const CARRY = {
  flowId: 'AB'.repeat(32),
  ecdhPublic: 'synthetic-point',
  trackingCode: 'fresh-route',
  sysNum: '23',
  langNum: '1',
  sid: 'synthetic-session',
  did: 'synthetic-device',
  challenge: 'synthetic-challenge',
  pwdAssertionId: 'synthetic-assertion',
};
const CREDS = { username: 'SyntheticUser', password: 'synthetic-password' };
const PASSWORD = {
  type: 'password',
  locked: false,
  expired: false,
  assertion_id: CARRY.pwdAssertionId,
};
const HEADERS: JsonValue[] = [
  { type: 'session_id', session_id: 'synthetic-session' },
  { type: 'device_id', device_id: 'synthetic-device' },
];

interface ITransmitModule {
  readonly LEUMI_TRANSMIT_STEPS: readonly IPostStep[];
}

/**
 * Finds a configured step by name.
 * @param name - Step name.
 * @returns The step.
 */
async function stepNamed(name: string): Promise<IPostStep> {
  const module = (await import(MODULE)) as ITransmitModule;
  const step = module.LEUMI_TRANSMIT_STEPS.find(candidate => candidate.name === name);
  if (!step) throw new TypeError(`Missing step ${name}`);
  return step;
}

/**
 * Constructs a pending synthetic challenge.
 * @param method - Offered method.
 * @param headers - Synthetic session headers.
 * @param challengeText - Synthetic challenge text.
 * @returns Opened answer.
 */
function challenge(
  method: Readonly<Record<string, JsonValue>>,
  headers: JsonValue = HEADERS,
  challengeText: string = CARRY.challenge,
): JsonValue {
  const control = [{ type: 'authentication', methods: [method] }];
  return { headers, data: { state: 'pending', challenge: challengeText, control_flow: control } };
}

/**
 * Constructs a completed synthetic password answer.
 * @param status - Website status.
 * @returns Opened answer.
 */
function completed(status: JsonValue): JsonValue {
  const data = { state: 'completed', assertions_complete: true, token: 'synthetic.jwt.token' };
  return { data: { ...data, data: { json_data: { ts_status: status } } } };
}

describe('Leumi encrypted identity and password', () => {
  it('accepts the unlocked password challenge with bounded identifiers', async () => {
    const step = await stepNamed('login');
    const answer = challenge(PASSWORD);
    const result = classifyAnswer(step, answer);
    expect(result).toEqual({
      success: true,
      value: {
        loginBranch: 'password',
        challenge: CARRY.challenge,
        pwdAssertionId: CARRY.pwdAssertionId,
      },
    });
  });

  it.each([
    [{ ...PASSWORD, locked: true }, ScraperErrorTypes.AccountBlocked],
    [{ ...PASSWORD, expired: true }, ScraperErrorTypes.ChangePassword],
    [{ ...PASSWORD, type: 'otp' }, ScraperErrorTypes.Generic],
    [{ ...PASSWORD, assertion_id: '' }, ScraperErrorTypes.Generic],
    [{ ...PASSWORD, assertion_id: '   ' }, ScraperErrorTypes.Generic],
  ] as const)('refuses an unavailable password challenge', async (method, errorType) => {
    const step = await stepNamed('login');
    const answer = challenge(method);
    const result = classifyAnswer(step, answer);
    expect(result).toMatchObject({ success: false, errorType });
  });

  it.each([
    [{ type: 'session_id', session_id: '   ' }, HEADERS[1]],
    [HEADERS[0], { type: 'device_id', device_id: '   ' }],
  ])('refuses a whitespace-only SDK session identifier', async (...headers) => {
    const step = await stepNamed('login');
    const answer = challenge(PASSWORD, headers);
    const result = classifyAnswer(step, answer);
    expect(result.success).toBe(false);
  });

  it('refuses a whitespace-only challenge before password submission', async () => {
    const step = await stepNamed('login');
    const answer = challenge(PASSWORD, HEADERS, '   ');
    const result = classifyAnswer(step, answer);
    expect(result.success).toBe(false);
  });

  it('does not label an unrecognized assertion error as a wrong password', async () => {
    const step = await stepNamed('assertPassword');
    const answer = { data: { assertion_error_code: 999 } };
    const result = guardBankError(step, answer);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
  });

  it('accepts completion only with website status zero', async () => {
    const step = await stepNamed('assertPassword');
    const answer = completed(0);
    const result = classifyAnswer(step, answer);
    expect(result).toEqual({ success: true, value: { authBranch: 'done' } });
  });

  it.each([
    [5, ScraperErrorTypes.ChangePassword],
    [1, ScraperErrorTypes.Generic],
    ['0', ScraperErrorTypes.Generic],
    [null, ScraperErrorTypes.Generic],
  ] as const)('refuses unsupported or reminder website status', async (status, errorType) => {
    const step = await stepNamed('assertPassword');
    const answer = completed(status);
    const result = classifyAnswer(step, answer);
    expect(result).toMatchObject({ success: false, errorType });
  });

  it('hydrates the five website policy fields without changing username casing', async () => {
    const step = await stepNamed('login');
    const fingerprint = { metadata: { app: 'synthetic' } };
    const scope = { carry: CARRY, creds: CREDS, config: CONFIG, fingerprint };
    const body = hydrate(step.body.shape, scope);
    expect(body).toEqual({
      success: true,
      value: {
        headers: [
          { type: 'flow_id', flow_id: CARRY.flowId },
          { type: 'uid', uid: CREDS.username },
        ],
        data: {
          policy_request_id: 'authenticate',
          params: {
            trackingCode: CARRY.trackingCode,
            customerAccountId: '',
            langNum: CARRY.langNum,
            purpose: '',
            sysNum: CARRY.sysNum,
          },
          collection_result: fingerprint,
        },
      },
    });
  });
});
