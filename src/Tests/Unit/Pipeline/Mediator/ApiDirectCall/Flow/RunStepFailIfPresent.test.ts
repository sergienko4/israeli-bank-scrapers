/**
 * N20 — a step's `failIfPresent` pointers are checked right after the body is
 * parsed: a present, truthy value fails the step `<step> bank error`, typed
 * by its `bankErrorType` (Generic when unset), before its outcome and before
 * its extracts, and the message names no value. Absent, null, false, 0, ''
 * and empty arrays or records are not errors.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { guardBankError } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.failIfPresent.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeStubMediator } from './StubMediator.js';
import { WARM_STEP_TAG } from './WarmStartFixtures.js';

const HINT = CompanyTypes.OneZero;
const SECRET = 'tok_9f8e7d6c5b4a';
const ERRORS = ['/error', '/Error', '/errors'] as const;

/** A step without a guard or an outcome policy. */
const PLAIN: IStepConfig = {
  name: 'bind',
  urlTag: WARM_STEP_TAG,
  body: { shape: {} },
  extractsToCarry: { token: '/access_token' },
};

/** The same step, guarded by the error pointers. */
const GUARDED: IStepConfig = { ...PLAIN, failIfPresent: ERRORS };

/** The guarded step, typing its bank errors as a wrong password. */
const TYPED: IStepConfig = { ...GUARDED, bankErrorType: ScraperErrorTypes.InvalidPassword };

/** Expected failure for a bank error. */
const BANK_ERROR = {
  success: false,
  errorType: ScraperErrorTypes.Generic,
  errorMessage: 'bind bank error',
};

/** Expected failure for a bank error on the typed step. */
const TYPED_ERROR = { ...BANK_ERROR, errorType: ScraperErrorTypes.InvalidPassword };

/** An outcome whose default failure is a wrong OTP. */
const OTP_OUTCOME = {
  codePointer: '/state',
  successCodes: ['landpage'],
  failureMap: {},
  defaultFailure: ScraperErrorTypes.InvalidOtp,
};

/**
 * Run the one-step flow against a scripted bank answer.
 * @param step - The step to run.
 * @param answer - The bank's 2xx body.
 * @returns The flow result.
 */
async function runOne(step: IStepConfig, answer: JsonValue): Promise<unknown> {
  const bus = makeStubMediator({ responses: [succeed(answer)], captures: [] });
  const config: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [step] };
  return runSmsOtpFlow({ config, bus, creds: {}, companyId: HINT });
}

beforeAll((): void => {
  registerWkUrl(WARM_STEP_TAG, HINT, 'https://example.test/api/guard');
});

describe('guardBankError', () => {
  it.each<[string, JsonValue]>([
    ['a non-empty error list', { errors: ['x'] }],
    ['an error text', { error: SECRET }],
    ['an error record', { Error: { code: 1 } }],
    ['a true flag', { error: true }],
    ['a non-zero code', { error: 3 }],
  ])('fails on %s, naming no value', (_label, resp) => {
    const guarded = guardBankError(GUARDED, resp);
    expect(guarded).toMatchObject(BANK_ERROR);
    const text = JSON.stringify(guarded);
    expect(text).not.toContain(SECRET);
  });

  it.each<[string, JsonValue]>([
    ['no error field', { ok: 1 }],
    ['null', { error: null }],
    ['false', { error: false }],
    ['zero', { error: 0 }],
    ['an empty text', { Error: '' }],
    ['an empty list', { errors: [] }],
    ['an empty record', { errors: {} }],
    ['a non-record body', ['x']],
  ])('passes %s', (_label, resp) => {
    const guarded = guardBankError(GUARDED, resp);
    expect(guarded).toEqual({ success: true, value: true });
  });

  it('passes any body when the step declares no guard', () => {
    const guarded = guardBankError(PLAIN, { errors: ['x'] });
    expect(guarded.success).toBe(true);
  });

  it("fails with the step's bankErrorType, naming no value", () => {
    const guarded = guardBankError(TYPED, { error: SECRET });
    expect(guarded).toMatchObject(TYPED_ERROR);
    const text = JSON.stringify(guarded);
    expect(text).not.toContain(SECRET);
  });
});

describe('SmsOtpFlow with failIfPresent', () => {
  it('fails a step that has no outcome', async () => {
    const result = await runOne(GUARDED, { errors: ['x'], access_token: SECRET });
    expect(result).toMatchObject(BANK_ERROR);
  });

  it('fails Generic before an outcome whose default is InvalidOtp', async () => {
    const step = { ...GUARDED, outcome: OTP_OUTCOME };
    const result = await runOne(step, { state: 'nope', error: 'x' });
    expect(result).toMatchObject(BANK_ERROR);
  });

  it("fails with the bankErrorType, not the outcome's default", async () => {
    const step = { ...TYPED, outcome: OTP_OUTCOME };
    const result = await runOne(step, { state: 'nope', error: 'x' });
    expect(result).toMatchObject(TYPED_ERROR);
  });

  it('fails before the extracts run', async () => {
    const result = await runOne(GUARDED, { error: 'x' });
    expect(result).toMatchObject(BANK_ERROR);
  });

  it('ignores a falsy error field', async () => {
    const result = await runOne(GUARDED, { errors: [], error: null, access_token: SECRET });
    expect(result).toMatchObject({ success: true });
  });
});
