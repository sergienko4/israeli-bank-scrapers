/**
 * Durable (persistent-auth) branch of the config token strategy, on Pepper's
 * real call config: enrollment publishes the device state once before the
 * bearer is exposed; resume replays a fresh token without a request, or renews
 * an expired one through exactly login + one password assertion on the stored
 * device; nothing falls back to a cold or in-run flow; the legacy long-term
 * token outputs stay empty.
 */

import { jest } from '@jest/globals';

import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type {
  IConfigTokenStrategy,
  PersistentAuthMode,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  bodyData,
  BOUND_DEVICE_ID,
  cellPhoneIdOf,
  decodePublished,
  enrollResponses,
  type IStateRecorder,
  type IStoredFixture,
  loadPepperConfig,
  makeDurableStrategy,
  makeRecorder,
  makeStoredState,
  PEPPER_ACCOUNT,
  PEPPER_CTX,
  PEPPER_PASSWORD,
  pepperBlock,
  pepperCreds,
  registerPepperAuthUrls,
  resumeResponses,
  signatureKeyId,
  storedKeyId,
  urlsOf,
} from './DurableAuthFixtures.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import { makeJwt } from './WarmStartFixtures.js';

/** Outlives both the config skew (60 s) and the durable margin (300 s). */
const FRESH_JWT = makeJwt(3600);

/** Outlives the config skew but not the durable margin. */
const INSIDE_MARGIN_JWT = makeJwt(120);

/** Already expired. */
const EXPIRED_JWT = makeJwt(-60);

let config: IApiDirectCallConfig;

beforeAll(async (): Promise<void> => {
  registerPepperAuthUrls();
  config = await loadPepperConfig();
});

/** One durable prime's observable outputs. */
interface IPrimeRun {
  readonly result: Procedure<string>;
  readonly captures: IApiPostCapture[];
  readonly urls: readonly string[];
  readonly recorder: IStateRecorder;
  readonly retriever: jest.Mock;
  readonly strategy: IConfigTokenStrategy;
}

/**
 * Build the mode for a durable run.
 * @param recorder - State recorder.
 * @param stored - Stored state for resume; omitted for enrollment.
 * @returns Durable mode.
 */
function durableMode(recorder: IStateRecorder, stored?: IStoredFixture): PersistentAuthMode {
  const block = pepperBlock(config);
  const base = { block, onUpdate: recorder.onUpdate, account: PEPPER_ACCOUNT };
  if (stored === undefined) return { kind: 'enroll', ...base };
  return { kind: 'resume', ...base, encodedState: stored.encoded };
}

/**
 * Run one primeInitial on a fresh durable strategy.
 * @param responses - Scripted bank responses.
 * @param stored - Stored state for resume; omitted for enrollment.
 * @param primeConfig - Bank config; Pepper's unless a case overrides it.
 * @returns Result, captures, recorder and OTP retriever spy.
 */
async function runPrime(
  responses: readonly Procedure<unknown>[],
  stored?: IStoredFixture,
  primeConfig: IApiDirectCallConfig = config,
): Promise<IPrimeRun> {
  const captures: IApiPostCapture[] = [];
  const recorder = makeRecorder();
  const retriever = jest.fn(async (): Promise<string> => Promise.resolve('123456'));
  const mode = durableMode(recorder, stored);
  const strategy = makeDurableStrategy(primeConfig, mode);
  const bus = makeStubMediator({ responses, captures });
  const creds = pepperCreds(retriever);
  const result = await strategy.primeInitial(bus, PEPPER_CTX, creds);
  recorder.events.push('returned');
  return { result, captures, urls: urlsOf(captures), recorder, retriever, strategy };
}

/**
 * Enroll once, the bank issuing the given token.
 * @param token - JWT the OTP assertion returns.
 * @returns Observable outputs.
 */
async function runEnroll(token: string): Promise<IPrimeRun> {
  const responses = enrollResponses(token);
  return runPrime(responses);
}

/**
 * Resume from stored state, the bank renewing to the given token if asked.
 * @param stored - Stored state.
 * @param renewed - JWT a renewal returns.
 * @returns Observable outputs.
 */
async function runResume(stored: IStoredFixture, renewed: string): Promise<IPrimeRun> {
  const responses = resumeResponses(renewed);
  return runPrime(responses, stored);
}

describe('durable enrollment', () => {
  it('runs the SMS flow once and publishes the bound device state before returning', async () => {
    const run = await runEnroll(FRESH_JWT);
    expect(run.result).toEqual({ success: true, value: FRESH_JWT });
    expect(run.urls).toEqual(['auth.bind', 'auth.assert', 'auth.assert']);
    expect(run.recorder.events).toEqual(['published', 'returned']);
    expect(run.retriever).toHaveBeenCalledTimes(1);
    const { state } = decodePublished(run.recorder.published[0]);
    const boundInstanceId = cellPhoneIdOf(run.captures[0]);
    expect(state).toMatchObject({ clientInstanceId: boundInstanceId, deviceId: BOUND_DEVICE_ID });
    expect(state.accessToken).toBe(FRESH_JWT);
  });

  it('publishes the private key whose public half was bound', async () => {
    const run = await runEnroll(FRESH_JWT);
    const { ecKeypair } = decodePublished(run.recorder.published[0]);
    const bindData = bodyData(run.captures[0]);
    expect(bindData.public_key).toMatchObject({ key: ecKeypair.publicKeyBase64 });
  });

  it('leaves the legacy long-term token outputs empty and the run cold', async () => {
    const run = await runEnroll(FRESH_JWT);
    const longTermToken = run.strategy.getLatestLongTermToken();
    const wasWarm = run.strategy.lastPrimeWasWarm();
    expect({ longTermToken, wasWarm }).toEqual({ longTermToken: '', wasWarm: false });
  });
});

describe('durable resume — fresh replay', () => {
  it('replays a token outside the margin with zero requests and zero publishes', async () => {
    const stored = makeStoredState(FRESH_JWT);
    const run = await runPrime([], stored);
    expect(run.result).toEqual({ success: true, value: FRESH_JWT });
    expect(run.captures).toHaveLength(0);
    expect(run.recorder.invocations).toHaveLength(0);
    const carry = run.strategy.getLatestCarrySnapshot();
    expect(carry).toEqual({ token: FRESH_JWT });
  });

  it('leaves the legacy long-term token outputs empty and the run cold on replay', async () => {
    const stored = makeStoredState(FRESH_JWT);
    const run = await runPrime([], stored);
    const longTermToken = run.strategy.getLatestLongTermToken();
    const wasWarm = run.strategy.lastPrimeWasWarm();
    expect({ longTermToken, wasWarm }).toEqual({ longTermToken: '', wasWarm: false });
  });

  it('renews a token inside the durable margin even though the config skew accepts it', async () => {
    const stored = makeStoredState(INSIDE_MARGIN_JWT);
    const run = await runResume(stored, FRESH_JWT);
    expect(run.urls).toEqual(['auth.login', 'auth.assert']);
  });
});

describe('durable resume — expired renewal', () => {
  it('renews through login + one password assertion and publishes before returning', async () => {
    const stored = makeStoredState(EXPIRED_JWT);
    const run = await runResume(stored, FRESH_JWT);
    expect(run.result).toEqual({ success: true, value: FRESH_JWT });
    expect(run.urls).toEqual(['auth.login', 'auth.assert']);
    expect(run.recorder.events).toEqual(['published', 'returned']);
    expect(run.retriever).not.toHaveBeenCalled();
    const published = decodePublished(run.recorder.published[0]);
    expect(published.state).toEqual({ ...stored.state, accessToken: FRESH_JWT });
  });

  it('sends the stored client instance id and device id on login', async () => {
    const stored = makeStoredState(EXPIRED_JWT);
    const run = await runResume(stored, FRESH_JWT);
    const sentInstanceId = cellPhoneIdOf(run.captures[0]);
    expect(sentInstanceId).toBe(stored.state.clientInstanceId);
    expect(run.captures[0].query?.did).toBe(stored.state.deviceId);
    expect(run.captures[1].query?.did).toBe(stored.state.deviceId);
  });

  it('signs both renewal requests with the stored device key', async () => {
    const stored = makeStoredState(EXPIRED_JWT);
    const run = await runResume(stored, FRESH_JWT);
    const keyIds = run.captures.map(signatureKeyId);
    const expectedKeyId = storedKeyId(stored);
    expect(keyIds).toEqual([expectedKeyId, expectedKeyId]);
  });

  it('asserts the password under the action and assertion id login returned', async () => {
    const stored = makeStoredState(EXPIRED_JWT);
    const run = await runResume(stored, FRESH_JWT);
    const assertData = bodyData(run.captures[1]);
    expect(assertData.action).toBe('authentication');
    expect(assertData.assertion_id).toBe('pwd-login');
    expect(assertData.data).toEqual({ password: PEPPER_PASSWORD });
  });

  it('leaves the legacy long-term token output empty after renewal', async () => {
    const stored = makeStoredState(EXPIRED_JWT);
    const run = await runResume(stored, FRESH_JWT);
    const longTermToken = run.strategy.getLatestLongTermToken();
    expect(run.result.success).toBe(true);
    expect(longTermToken).toBe('');
  });
});

describe('durable bearer formatting', () => {
  const storedTokens = [
    ['replayed', FRESH_JWT],
    ['renewed', EXPIRED_JWT],
  ] as const;

  it.each(storedTokens)('formats the %s bearer through the config auth scheme', async (...row) => {
    const [, storedToken] = row;
    const stored = makeStoredState(storedToken);
    const responses = resumeResponses(FRESH_JWT);
    const bearerConfig: IApiDirectCallConfig = { ...config, authScheme: 'bearer' };
    const run = await runPrime(responses, stored, bearerConfig);
    expect(run.result).toEqual({ success: true, value: `Bearer ${FRESH_JWT}` });
  });
});
