/**
 * Durable device-auth mode resolution and strategy wiring (Task 9 of the
 * Pepper durable-auth plan). One mode is chosen before any auth request; an
 * invalid option combination fails with a category only — never a state,
 * token or phone value — and before the bus or the strategy is touched. Banks
 * without a persistent-auth block stay legacy whatever options they receive.
 */

import { PassThrough } from 'node:stream';

import pino from 'pino';

import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Logging/Debug.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { ITokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
import {
  runApiDirectCallAction,
  runApiDirectCallPre,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.js';
import { resolvePersistentAuthMode } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.persistent.js';
import {
  readPersistentAuthInput,
  resolveContextAuthMode,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.pre.js';
import type {
  IApiDirectCallConfig,
  IPersistentAuthConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  createTokenStrategyFromConfig,
  type PersistentAuthMode,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import type { ITokenContext } from '../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import { LOGIN_KIND_VALUES } from '../../../../../Scrapers/Pipeline/Types/LoginKind.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeJwtWithClaims } from '../../../../Helpers/Jwt.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { type IApiPostCapture, makeStubMediator } from './Flow/StubMediator.js';

/** Unpadded base64url of a v1-shaped JSON prefix — realistic opaque state. */
const OPAQUE_STATE = 'eyJ2ZXJzaW9uIjoxLCJwcm92aWRlciI6InBlcHBlciJ9';

/** Legacy long-term token value — the conflicting OneZero/PayBox input. */
const LEGACY_TOKEN = makeJwtWithClaims({ sub: 'fixt' });

/** Synthetic normalised phone the durable state is bound to. */
const ACCOUNT_PHONE = '+972500000017';

/** Both option names that must never reach generic credentials. */
const PERSISTENT_OPTION_NAMES: readonly string[] = [
  'persistentAuthState',
  'onPersistentAuthStateUpdate',
];

/**
 * Stand-in for a caller's durable storage write.
 * @returns Resolved promise acknowledging the write.
 */
async function storeStateStub(): Promise<void> {
  await Promise.resolve();
}

/** Option fragments the row tables combine. */
const STATE = { persistentAuthState: OPAQUE_STATE };
const CALLBACK = { onPersistentAuthStateUpdate: storeStateStub };
const NULL_STATE = { persistentAuthState: null };
const STRING_CALLBACK = { onPersistentAuthStateUpdate: 'not-a-function' };

/** Synthetic persistent-auth block — one inert renewal step. */
const DURABLE_BLOCK: IPersistentAuthConfig = {
  provider: 'pepper-test',
  resumeSteps: [{ name: 'login', urlTag: 'auth.login', body: { shape: {} }, extractsToCarry: {} }],
  clientInstanceIdField: 'clientInstanceId',
  deviceIdField: 'deviceId',
  accountField: 'phoneNumber',
  freshnessMarginSeconds: 300,
};

/**
 * Api-direct-call config with a warm-start slot and no persistent-auth block.
 * @returns Legacy config literal.
 */
function makeLegacyConfig(): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    steps: [
      { name: 'getIdToken', urlTag: 'auth.assert', body: { shape: {} }, extractsToCarry: {} },
    ],
    warmStart: { credsField: 'otpLongTermToken', carryField: 'token', fromStepIndex: 0 },
  };
}

/**
 * The legacy config plus the synthetic persistent-auth block.
 * @returns Durable config literal.
 */
function makeDurableConfig(): IApiDirectCallConfig {
  return { ...makeLegacyConfig(), persistentAuth: DURABLE_BLOCK };
}

/** Raw options plus whether the legacy token is also supplied. */
interface ICtxInputs {
  readonly options: Readonly<Record<string, unknown>>;
  readonly hasToken: boolean;
}

/**
 * Build a context carrying raw options, the account phone and, optionally,
 * the legacy token. Options are `unknown` to model JavaScript callers.
 * @param inputs - Raw options and token presence.
 * @returns Pipeline context.
 */
function makeCtx(inputs: ICtxInputs): IPipelineContext {
  const base = makeMockContext();
  const token = inputs.hasToken ? { otpLongTermToken: LEGACY_TOKEN } : {};
  const credentials = { ...base.credentials, phoneNumber: ACCOUNT_PHONE, ...token };
  const options = { ...base.options, ...inputs.options };
  return { ...base, credentials, options };
}

/**
 * Resolve the mode for one context against one config.
 * @param config - Api-direct-call config.
 * @param inputs - Raw options and token presence.
 * @returns Resolved mode procedure.
 */
function resolveFor(
  config: IApiDirectCallConfig,
  inputs: ICtxInputs,
): Procedure<PersistentAuthMode> {
  const ctx = makeCtx(inputs);
  return resolveContextAuthMode(config, ctx);
}

/** Valid combinations from the approved mode table and the mode they pick. */
const VALID_ROWS = [
  { label: 'nothing', options: {}, hasToken: false, kind: 'legacy' },
  { label: 'legacy token only', options: {}, hasToken: true, kind: 'legacy' },
  { label: 'callback only', options: CALLBACK, hasToken: false, kind: 'enroll' },
  {
    label: 'state and callback',
    options: { ...STATE, ...CALLBACK },
    hasToken: false,
    kind: 'resume',
  },
] as const;

/** Invalid combinations and the single category each fails with. */
const INVALID_ROWS = [
  { label: 'state only', options: STATE, hasToken: false, category: 'state-without-callback' },
  { label: 'state and token', options: STATE, hasToken: true, category: 'state-with-legacy-token' },
  {
    label: 'callback and token',
    options: CALLBACK,
    hasToken: true,
    category: 'callback-with-legacy-token',
  },
  {
    label: 'state, callback and token',
    options: { ...STATE, ...CALLBACK },
    hasToken: true,
    category: 'state-with-legacy-token',
  },
  {
    label: 'null state with callback',
    options: { ...NULL_STATE, ...CALLBACK },
    hasToken: false,
    category: 'malformed',
  },
  {
    label: 'state with string callback',
    options: { ...STATE, ...STRING_CALLBACK },
    hasToken: false,
    category: 'malformed',
  },
  {
    label: 'malformed callback and token',
    options: STRING_CALLBACK,
    hasToken: true,
    category: 'malformed',
  },
] as const;

/** The only verdict a bank without a persistent-auth block may receive. */
const LEGACY_RESULT = succeed({ kind: 'legacy' });

/** Every combination a legacy bank might be handed, valid or not. */
const ALL_ROWS = [...VALID_ROWS, ...INVALID_ROWS];

describe('resolvePersistentAuthMode — durable bank', () => {
  it.each(VALID_ROWS)('$label → $kind', ({ options, hasToken, kind }) => {
    const config = makeDurableConfig();
    const mode = resolveFor(config, { options, hasToken });
    expect(isOk(mode) && mode.value.kind).toBe(kind);
  });

  it.each(INVALID_ROWS)('$label fails with $category only', ({ options, hasToken, category }) => {
    const config = makeDurableConfig();
    const mode = resolveFor(config, { options, hasToken });
    expect(mode).toMatchObject({
      success: false,
      errorMessage: `persistent auth options invalid: ${category}`,
    });
  });

  it('builds the resume mode from the block, the callback, the account and the state', () => {
    const config = makeDurableConfig();
    const mode = resolveFor(config, { options: { ...STATE, ...CALLBACK }, hasToken: false });
    const expected = succeed({
      kind: 'resume',
      block: DURABLE_BLOCK,
      onUpdate: storeStateStub,
      account: ACCOUNT_PHONE,
      encodedState: OPAQUE_STATE,
    });
    expect(mode).toEqual(expected);
  });

  it('builds the enrollment mode without any state field', () => {
    const config = makeDurableConfig();
    const mode = resolveFor(config, { options: CALLBACK, hasToken: false });
    const expected = succeed({
      kind: 'enroll',
      block: DURABLE_BLOCK,
      onUpdate: storeStateStub,
      account: ACCOUNT_PHONE,
    });
    expect(mode).toEqual(expected);
  });

  it('treats a non-string account credential as an empty account', () => {
    const config = makeDurableConfig();
    const ctx = makeCtx({ options: CALLBACK, hasToken: false });
    const input = readPersistentAuthInput(ctx);
    const mode = resolvePersistentAuthMode(config, input, { phoneNumber: 972500000017 });
    expect(isOk(mode) && mode.value.kind === 'enroll' && mode.value.account).toBe('');
  });

  it('treats an empty legacy token as absent', () => {
    const config = makeDurableConfig();
    const ctx = makeCtx({ options: CALLBACK, hasToken: false });
    const input = readPersistentAuthInput(ctx);
    const mode = resolvePersistentAuthMode(config, input, { otpLongTermToken: '' });
    expect(isOk(mode) && mode.value.kind).toBe('enroll');
  });
});

describe('resolvePersistentAuthMode — banks without a persistent-auth block', () => {
  it.each(ALL_ROWS)('synthetic legacy bank: $label → legacy', ({ options, hasToken }) => {
    const config = makeLegacyConfig();
    const mode = resolveFor(config, { options, hasToken });
    expect(mode).toEqual(LEGACY_RESULT);
  });

  it.each(ALL_ROWS)('real OneZero config: $label → legacy', async ({ options, hasToken }) => {
    const path = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigOneZero.js';
    const mod = (await import(path)) as { readonly default: IApiDirectCallConfig };
    const mode = resolveFor(mod.default, { options, hasToken });
    expect(mode).toEqual(LEGACY_RESULT);
  });
});

/** What the spy bus observed during one ACTION run. */
interface ISpyRecord {
  readonly captures: IApiPostCapture[];
  readonly creds: unknown[];
  readonly strategies: unknown[];
  primeCalls: number;
}

/**
 * Build a stub bus that records primeSession calls and the strategy wiring.
 * @param record - Observation sink.
 * @returns Spy ApiMediator.
 */
function makeSpyBus(record: ISpyRecord): IApiMediator {
  const stub = makeStubMediator({ responses: [], captures: record.captures, primeBearer: 'b' });
  /**
   * Count the call, then delegate to the stub.
   * @returns The stub's bearer procedure.
   */
  async function primeSession(): Promise<Procedure<string>> {
    record.primeCalls += 1;
    return stub.primeSession();
  }
  /**
   * Record the strategy and credentials the ACTION stage registers.
   * @param strategy - Strategy being registered.
   * @param _ctx - Token context (unused).
   * @param creds - Credentials under test.
   * @returns true — resolver set.
   */
  function withTokenStrategy<TCreds>(
    strategy: ITokenStrategy<TCreds>,
    _ctx: ITokenContext,
    creds: TCreds,
  ): true {
    record.strategies.push(strategy);
    record.creds.push(creds);
    return true;
  }
  return { ...stub, primeSession, withTokenStrategy };
}

/**
 * Run the ACTION stage against a spy bus.
 * @param config - Api-direct-call config.
 * @param inputs - Raw options and token presence.
 * @returns ACTION result plus everything the bus observed.
 */
async function runAction(
  config: IApiDirectCallConfig,
  inputs: ICtxInputs,
): Promise<{ readonly result: Procedure<IPipelineContext>; readonly record: ISpyRecord }> {
  const record: ISpyRecord = { captures: [], creds: [], strategies: [], primeCalls: 0 };
  const bus = makeSpyBus(record);
  const apiMediator = some(bus);
  const ctx = makeCtx(inputs);
  const result = await runApiDirectCallAction(config, { ...ctx, apiMediator });
  return { result, record };
}

describe('ApiDirectCall ACTION — durable mode wiring', () => {
  it.each(INVALID_ROWS)(
    '$label fails before any request or strategy',
    async ({ options, hasToken, category }) => {
      const config = makeDurableConfig();
      const { result, record } = await runAction(config, { options, hasToken });
      expect(result).toMatchObject({
        success: false,
        errorMessage: `persistent auth options invalid: ${category}`,
      });
      expect(record).toEqual({ captures: [], creds: [], strategies: [], primeCalls: 0 });
    },
  );

  it.each([
    { label: 'enroll', options: CALLBACK },
    { label: 'resume', options: { ...STATE, ...CALLBACK } },
  ])('$label keeps both options out of creds and carry', async ({ options }) => {
    const config = makeDurableConfig();
    const { result, record } = await runAction(config, { options, hasToken: false });
    expect(result.success).toBe(true);
    const [creds] = record.creds as Readonly<Record<string, unknown>>[];
    const credKeys = Object.keys(creds);
    const leakedKeys = credKeys.filter(key => PERSISTENT_OPTION_NAMES.includes(key));
    expect(leakedKeys).toEqual([]);
    const [strategy] = record.strategies as ReturnType<typeof createStrategyFor>[];
    const carry = strategy.getLatestCarrySnapshot();
    const snapshot = JSON.stringify(carry);
    const serialisedCreds = JSON.stringify(creds);
    expect(serialisedCreds).not.toContain(OPAQUE_STATE);
    expect(snapshot).toBe('{}');
  });

  it('a legacy bank with stray durable options still primes exactly once', async () => {
    const config = makeLegacyConfig();
    const options = { ...STATE, ...STRING_CALLBACK };
    const { result, record } = await runAction(config, { options, hasToken: true });
    expect(result.success).toBe(true);
    expect(record.primeCalls).toBe(1);
  });
});

/**
 * Build a logger that collects every serialized line, at debug level.
 * @param lines - Sink receiving each log line.
 * @returns Capturing pino logger.
 */
function makeCapturingLogger(lines: string[]): ScraperLogger {
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => {
    const line = chunk.toString();
    lines.push(line);
  });
  return pino({ level: 'debug' }, stream);
}

/**
 * Run the PRE stage and return the login kind it logged.
 * @param config - Api-direct-call config.
 * @param inputs - Raw options and token presence.
 * @returns Logged kind, or '' when none was logged.
 */
async function preKind(config: IApiDirectCallConfig, inputs: ICtxInputs): Promise<string> {
  const lines: string[] = [];
  const logger = makeCapturingLogger(lines);
  const ctx = makeCtx(inputs);
  const result = await runApiDirectCallPre(config, { ...ctx, logger });
  expect(result.success).toBe(true);
  const output = lines.join('');
  const match = /PRE kind='([a-z-]+)'/.exec(output);
  return match?.[1] ?? '';
}

describe('ApiDirectCall PRE — durable diagnostic', () => {
  it.each([
    {
      label: 'durable resume',
      durable: true,
      options: { ...STATE, ...CALLBACK },
      kind: 'password-only',
    },
    { label: 'durable enrollment', durable: true, options: CALLBACK, kind: 'sms-otp' },
    { label: 'invalid durable options', durable: true, options: STATE, kind: 'sms-otp' },
    {
      label: 'legacy bank with state and callback',
      durable: false,
      options: { ...STATE, ...CALLBACK },
      kind: 'sms-otp',
    },
  ])('$label logs $kind', async ({ durable, options, kind }) => {
    const config = durable ? makeDurableConfig() : makeLegacyConfig();
    const logged = await preKind(config, { options, hasToken: false });
    expect(logged).toBe(kind);
  });

  it('keeps the legacy-token classification for a durable bank without durable options', async () => {
    const config = makeDurableConfig();
    const logged = await preKind(config, { options: {}, hasToken: true });
    expect(logged).toBe('stored-jwt-stale');
  });

  it('adds no LoginKind value', () => {
    expect(LOGIN_KIND_VALUES).toEqual([
      'stored-jwt-fresh',
      'stored-jwt-stale',
      'sms-otp',
      'password-only',
      'bearer-static',
      'unknown',
    ]);
  });
});

/**
 * Build a strategy for the durable config in the supplied mode.
 * @param mode - Resolved mode, or undefined for the pre-Task-9 call shape.
 * @returns The created strategy.
 */
function createStrategyFor(mode?: PersistentAuthMode): {
  getLatestLongTermToken(): string;
  getLatestCarrySnapshot(): Readonly<Record<string, unknown>>;
} {
  const config = makeDurableConfig();
  const proc = createTokenStrategyFromConfig({ config, persistentAuth: mode });
  if (!isOk(proc)) throw new TypeError(proc.errorMessage);
  return proc.value;
}

describe('createTokenStrategyFromConfig — private mode slot', () => {
  const base = { block: DURABLE_BLOCK, onUpdate: storeStateStub, account: ACCOUNT_PHONE };
  it.each([
    { label: 'legacy', mode: { kind: 'legacy' } },
    { label: 'enroll', mode: { kind: 'enroll', ...base } },
    { label: 'resume', mode: { kind: 'resume', ...base, encodedState: OPAQUE_STATE } },
  ] as const)('$label exposes the same bindings and getters as no mode', ({ mode }) => {
    const plain = createStrategyFor();
    const withMode = createStrategyFor(mode);
    const plainKeys = Object.keys(plain).sort();
    const modeKeys = Object.keys(withMode).sort();
    expect(modeKeys).toEqual(plainKeys);
    const token = withMode.getLatestLongTermToken();
    const carry = withMode.getLatestCarrySnapshot();
    expect(token).toBe('');
    expect(carry).toEqual({});
  });
});
