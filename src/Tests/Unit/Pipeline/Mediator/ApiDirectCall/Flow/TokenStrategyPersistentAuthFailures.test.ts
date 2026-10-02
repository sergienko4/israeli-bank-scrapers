/**
 * Durable (persistent-auth) failure paths, on Pepper's real call config.
 *
 * Every durable failure must stay local: no bind, no OTP, no cold flow and no
 * in-run renewal. Each case resolves through the real resolver ladder so a
 * silent cold fallback would show up as an extra `auth.bind` request.
 */

import { jest } from '@jest/globals';

import { buildResolverFromStrategy } from '../../../../../../Scrapers/Pipeline/Mediator/Api/TokenResolverBuilder.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { PersistentAuthMode } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  enrollResponses,
  type IStateRecorder,
  type IStoredFixture,
  loadPepperConfig,
  loginResponse,
  makeDurableStrategy,
  makeRecorder,
  makeStoredState,
  PEPPER_ACCOUNT,
  PEPPER_CTX,
  pepperBlock,
  pepperCreds,
  registerPepperAuthUrls,
  resumeResponses,
  tokenResponse,
  transportFailure,
  urlsOf,
} from './DurableAuthFixtures.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import { makeJwt } from './WarmStartFixtures.js';

const FRESH_JWT = makeJwt(3600);
const EXPIRED_JWT = makeJwt(-60);
const CALLBACK_FAILURE = 'persistent auth failed: callback';
const REFRESH_REFUSED = 'persistent auth failed: in-run-renewal';

let config: IApiDirectCallConfig;

beforeAll(async (): Promise<void> => {
  registerPepperAuthUrls();
  config = await loadPepperConfig();
});

/** Inputs for one resolved durable run. */
interface IResolveCase {
  readonly responses: readonly Procedure<unknown>[];
  readonly stored?: IStoredFixture;
  readonly onUpdate?: (state: string) => Promise<void>;
  readonly account?: string;
}

/** Observable outputs of one resolved durable run. */
interface IResolveRun {
  readonly result: Procedure<string>;
  readonly urls: readonly string[];
  readonly callbacks: string[];
  readonly retriever: jest.Mock;
}

/**
 * Build the durable mode a case describes.
 * @param input - Case inputs.
 * @param onUpdate - State callback.
 * @returns Durable mode.
 */
function caseMode(
  input: IResolveCase,
  onUpdate: (state: string) => Promise<void>,
): PersistentAuthMode {
  const account = input.account ?? PEPPER_ACCOUNT;
  const block = pepperBlock(config);
  const base = { block, onUpdate, account };
  if (input.stored === undefined) return { kind: 'enroll', ...base };
  return { kind: 'resume', ...base, encodedState: input.stored.encoded };
}

/**
 * Resolve a durable strategy through the real resolver ladder.
 * @param input - Case inputs.
 * @returns Result, captures, state callbacks and OTP retriever spy.
 */
async function resolveCase(input: IResolveCase): Promise<IResolveRun> {
  const captures: IApiPostCapture[] = [];
  const recorder = makeRecorder();
  const retriever = jest.fn(async (): Promise<string> => Promise.resolve('123456'));
  const mode = caseMode(input, input.onUpdate ?? recorder.onUpdate);
  const strategy = makeDurableStrategy(config, mode);
  const bus = makeStubMediator({ responses: input.responses, captures });
  const creds = pepperCreds(retriever);
  const resolver = buildResolverFromStrategy({ strategy, bus, ctx: PEPPER_CTX, creds });
  const result = await resolver.resolve();
  return { result, urls: urlsOf(captures), callbacks: recorder.invocations, retriever };
}

/**
 * State callback that rejects with text echoing what it was given.
 * @param state - Opaque state.
 * @returns Never resolves.
 */
async function rejectingStore(state: string): Promise<void> {
  await Promise.resolve();
  throw new TypeError(`disk full while storing ${state}`);
}

/** Selector-miss message RunStep reports for a missing extract. */
const SELECTOR_MISS = 'envelope selector miss: ';

/** One renewal failure: name, scripted responses, expected requests, expected message. */
type RenewalFailure = readonly [string, readonly Procedure<unknown>[], string[], string];

const LOGIN_ONLY = ['auth.login'];
const LOGIN_AND_ASSERT = ['auth.login', 'auth.assert'];
const PASSWORD_MISS = `${SELECTOR_MISS}pwdAssertionId at /data/control_flow/0/methods/?type=password/assertion_id`;

const RENEWAL_FAILURES: readonly RenewalFailure[] = [
  [
    'a policy without a password method',
    [loginResponse([{ type: 'otp' }])],
    LOGIN_ONLY,
    PASSWORD_MISS,
  ],
  [
    'bank error 2017 on login',
    [succeed({ error_code: 2017 })],
    LOGIN_ONLY,
    `${SELECTOR_MISS}challenge at /data/challenge`,
  ],
  ['a transport failure on login', [transportFailure('network down')], LOGIN_ONLY, 'network down'],
  ['a 401 on login', [transportFailure('HTTP 401')], LOGIN_ONLY, 'HTTP 401'],
  [
    'a 403 on the password assertion',
    [loginResponse(), transportFailure('HTTP 403')],
    LOGIN_AND_ASSERT,
    'HTTP 403',
  ],
  [
    'a malformed replacement token',
    [loginResponse(), tokenResponse('not-a-jwt')],
    LOGIN_AND_ASSERT,
    'persistent auth state invalid: accessToken',
  ],
  [
    'a completion without a token',
    [loginResponse(), succeed({ data: {} })],
    LOGIN_AND_ASSERT,
    `${SELECTOR_MISS}token at /data/token`,
  ],
];

describe('durable renewal failures stay local', () => {
  it.each(RENEWAL_FAILURES)('fails on %s without bind, OTP or a cold flow', async (...row) => {
    const [, responses, expectedUrls, errorMessage] = row;
    const stored = makeStoredState(EXPIRED_JWT);
    const run = await resolveCase({ responses, stored });
    expect(run.result).toMatchObject({ success: false, errorMessage });
    expect(run.urls).toEqual(expectedUrls);
    expect(run.retriever).not.toHaveBeenCalled();
    expect(run.callbacks).toHaveLength(0);
  });
});

describe('durable state is validated before any request', () => {
  it('rejects undecodable state with zero requests', async () => {
    const valid = makeStoredState(EXPIRED_JWT);
    const stored = { ...valid, encoded: 'not-state' };
    const run = await resolveCase({ responses: [], stored });
    expect(run.result).toMatchObject({ success: false });
    expect(run.urls).toHaveLength(0);
  });

  it('rejects state bound to another account with zero requests', async () => {
    const stored = makeStoredState(FRESH_JWT);
    const run = await resolveCase({ responses: [], stored, account: '0509999999' });
    expect(run.result).toMatchObject({ success: false });
    expect(run.urls).toHaveLength(0);
  });
});

describe('durable callback failures', () => {
  it('withholds a renewed bearer the caller failed to store, without echoing it', async () => {
    const stored = makeStoredState(EXPIRED_JWT);
    const responses = resumeResponses(FRESH_JWT);
    const run = await resolveCase({ responses, stored, onUpdate: rejectingStore });
    expect(run.result).toMatchObject({ success: false, errorMessage: CALLBACK_FAILURE });
    expect(run.urls).toEqual(LOGIN_AND_ASSERT);
  });

  it('withholds an enrolled bearer the caller failed to store, with one OTP', async () => {
    const responses = enrollResponses(FRESH_JWT);
    const run = await resolveCase({ responses, onUpdate: rejectingStore });
    expect(run.result).toMatchObject({ success: false, errorMessage: CALLBACK_FAILURE });
    expect(run.urls).toHaveLength(3);
    expect(run.retriever).toHaveBeenCalledTimes(1);
  });
});

describe('durable enrollment failures', () => {
  it('stops at a failed bind with nothing published', async () => {
    const bindFailure = transportFailure('network down');
    const run = await resolveCase({ responses: [bindFailure] });
    expect(run.result.success).toBe(false);
    expect(run.urls).toEqual(['auth.bind']);
    expect(run.callbacks).toHaveLength(0);
  });

  it('refuses a second enrollment in the same run', async () => {
    const captures: IApiPostCapture[] = [];
    const recorder = makeRecorder();
    const mode = caseMode({ responses: [] }, recorder.onUpdate);
    const strategy = makeDurableStrategy(config, mode);
    const responses = enrollResponses(FRESH_JWT);
    const bus = makeStubMediator({ responses, captures });
    const creds = pepperCreds(async (): Promise<string> => Promise.resolve('123456'));
    await strategy.primeInitial(bus, PEPPER_CTX, creds);
    const second = await strategy.primeInitial(bus, PEPPER_CTX, creds);
    expect(second).toMatchObject({ errorMessage: 'persistent auth failed: enrollment-budget' });
    expect(captures).toHaveLength(3);
  });
});

describe('durable strategies never take the warm or in-run path', () => {
  const durableKinds = [['enroll'], ['resume']] as const;

  /**
   * Build a durable strategy for the named mode.
   * @param kind - Mode kind.
   * @param recorder - State recorder the mode calls back into.
   * @returns Strategy.
   */
  function strategyFor(
    kind: 'enroll' | 'resume',
    recorder: IStateRecorder,
  ): ReturnType<typeof makeDurableStrategy> {
    const stored = kind === 'resume' ? makeStoredState(FRESH_JWT) : undefined;
    const mode = caseMode({ responses: [], stored }, recorder.onUpdate);
    return makeDurableStrategy(config, mode);
  }

  it.each(durableKinds)('%s reports no warm state, even with a legacy token supplied', kind => {
    const recorder = makeRecorder();
    const strategy = strategyFor(kind, recorder);
    const hasWarmState = strategy.hasWarmState({ otpLongTermToken: FRESH_JWT });
    expect(hasWarmState).toBe(false);
  });

  it.each(durableKinds)('%s refuses primeFresh with zero requests or callbacks', async kind => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const recorder = makeRecorder();
    const strategy = strategyFor(kind, recorder);
    const result = await strategy.primeFresh(bus, PEPPER_CTX, {});
    expect(result).toMatchObject({ success: false, errorMessage: REFRESH_REFUSED });
    expect(captures).toHaveLength(0);
    expect(recorder.invocations).toHaveLength(0);
  });
});
