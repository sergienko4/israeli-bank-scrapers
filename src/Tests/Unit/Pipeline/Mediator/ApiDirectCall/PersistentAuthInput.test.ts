/**
 * Durable device-auth option isolation (Task 2 of the Pepper durable-auth
 * plan). The two new options carry a bearer token and a device private key,
 * so they must reach the token strategy only through the dedicated reader —
 * never through the merged credentials that feed template resolution, carry
 * snapshots, and logs — and their names must be redacted in every log sink.
 */

import { PassThrough } from 'node:stream';

import pino from 'pino';

import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { ITokenStrategy } from '../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
import { runApiDirectCallAction } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.js';
import {
  mergeOptionsIntoCreds,
  readPersistentAuthInput,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.pre.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { SENSITIVE_PATHS } from '../../../../../Scrapers/Pipeline/Types/DebugConfig.js';
import type { ITokenContext } from '../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { createCensorFn } from '../../../../../Scrapers/Pipeline/Types/PiiRedactor.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeStubMediator } from './Flow/StubMediator.js';

/** Unpadded base64url of a v1-shaped JSON prefix — realistic opaque state. */
const OPAQUE_STATE = 'eyJ2ZXJzaW9uIjoxLCJwcm92aWRlciI6InBlcHBlciJ9';

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

/**
 * Build a context whose options carry the supplied raw values. Values are
 * typed `unknown` so the suite can model JavaScript callers that bypass the
 * declared option types.
 * @param extra - Raw option overrides.
 * @returns Pipeline context.
 */
function makeCtxWithOptions(extra: Readonly<Record<string, unknown>>): IPipelineContext {
  const base = makeMockContext();
  const options = { ...base.options, ...extra };
  return { ...base, options };
}

/**
 * Minimal api-direct-call config: one step, no persistent-auth block — the
 * shape every non-durable bank has.
 * @returns IApiDirectCallConfig literal.
 */
function makeLegacyConfig(): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    steps: [
      { name: 'getIdToken', urlTag: 'auth.assert', body: { shape: {} }, extractsToCarry: {} },
    ],
  };
}

/**
 * Build a stub bus that records the credentials registered with the strategy.
 * @param seen - Sink receiving each registered credential record.
 * @returns Stub ApiMediator.
 */
function makeCapturingBus(seen: unknown[]): IApiMediator {
  const stub = makeStubMediator({ responses: [], captures: [], primeBearer: 'Bearer stub' });
  /**
   * Record the credentials the ACTION stage hands to the token strategy.
   * @param _strategy - Strategy being registered (unused).
   * @param _ctx - Token context (unused).
   * @param creds - Credentials under test.
   * @returns true — resolver set.
   */
  function withTokenStrategy<TCreds>(
    _strategy: ITokenStrategy<TCreds>,
    _ctx: ITokenContext,
    creds: TCreds,
  ): true {
    seen.push(creds);
    return true;
  }
  return { ...stub, withTokenStrategy };
}

/**
 * Run the ACTION stage and capture the credentials handed to the strategy.
 * @param ctx - Pipeline context.
 * @returns Credentials the bus received in withTokenStrategy.
 */
async function captureStrategyCreds(ctx: IPipelineContext): Promise<unknown[]> {
  const seen: unknown[] = [];
  const bus = makeCapturingBus(seen);
  const config = makeLegacyConfig();
  const apiMediator = some(bus);
  const result = await runApiDirectCallAction(config, { ...ctx, apiMediator });
  expect(result.success).toBe(true);
  return seen;
}

/**
 * Log one payload through pino wired to the production paths and censor.
 * @param payload - Object to log.
 * @returns Serialized log output.
 */
function logThroughProductionRedaction(payload: Readonly<Record<string, unknown>>): string {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const censor = createCensorFn() as unknown as (value: unknown, path: string[]) => unknown;
  const sink = pino({ level: 'info', redact: { paths: [...SENSITIVE_PATHS], censor } }, stream);
  sink.info(payload, 'persistent auth probe');
  return output;
}

describe('readPersistentAuthInput', () => {
  it('reports both options absent when neither is supplied', () => {
    const ctx = makeCtxWithOptions({});
    const input = readPersistentAuthInput(ctx);
    expect(input).toEqual({ state: { has: false }, onUpdate: { has: false }, isMalformed: false });
  });

  it('lifts a string state and a function callback', () => {
    const ctx = makeCtxWithOptions({
      persistentAuthState: OPAQUE_STATE,
      onPersistentAuthStateUpdate: storeStateStub,
    });
    const input = readPersistentAuthInput(ctx);
    expect(input.state).toEqual({ has: true, value: OPAQUE_STATE });
    expect(input.onUpdate).toEqual({ has: true, value: storeStateStub });
    expect(input.isMalformed).toBe(false);
  });

  it('keeps an empty-string state present so the codec can reject it', () => {
    const ctx = makeCtxWithOptions({ persistentAuthState: '' });
    const input = readPersistentAuthInput(ctx);
    expect(input.state).toEqual({ has: true, value: '' });
    expect(input.isMalformed).toBe(false);
  });

  it.each([
    ['a number state', { persistentAuthState: 1700000000 }],
    ['a null state', { persistentAuthState: null }],
    ['an object state', { persistentAuthState: { version: 1 } }],
    ['a string callback', { onPersistentAuthStateUpdate: 'storeState' }],
    ['a null callback', { onPersistentAuthStateUpdate: null }],
  ])('flags %s as malformed instead of treating it as absent', (_label, extra) => {
    const ctx = makeCtxWithOptions(extra);
    const input = readPersistentAuthInput(ctx);
    expect(input.isMalformed).toBe(true);
  });
});

describe('mergeOptionsIntoCreds persistent-auth isolation', () => {
  it('withholds both durable options while keeping every other option', () => {
    const ctx = makeCtxWithOptions({
      persistentAuthState: OPAQUE_STATE,
      onPersistentAuthStateUpdate: storeStateStub,
      onAuthFlowComplete: storeStateStub,
    });
    const merged = mergeOptionsIntoCreds(ctx);
    expect(merged).not.toHaveProperty('persistentAuthState');
    expect(merged).not.toHaveProperty('onPersistentAuthStateUpdate');
    expect(merged.onAuthFlowComplete).toBe(storeStateStub);
  });

  it('withholds durable option names smuggled through credentials', () => {
    const base = makeMockContext();
    const credentials = { ...base.credentials, persistentAuthState: OPAQUE_STATE };
    const ctx = { ...base, credentials } as IPipelineContext;
    const merged = mergeOptionsIntoCreds(ctx);
    expect(merged).not.toHaveProperty('persistentAuthState');
  });
});

describe('ACTION stage persistent-auth isolation for non-durable banks', () => {
  it('hands the strategy credentials without either durable option', async () => {
    const ctx = makeCtxWithOptions({
      persistentAuthState: OPAQUE_STATE,
      onPersistentAuthStateUpdate: storeStateStub,
    });
    const seen = await captureStrategyCreds(ctx);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('persistentAuthState');
    expect(seen[0]).not.toHaveProperty('onPersistentAuthStateUpdate');
  });

  it('keeps an existing long-term token on its legacy path beside stray options', async () => {
    const base = makeMockContext();
    const credentials = { ...base.credentials, otpLongTermToken: 'ltt-onezero-stored' };
    const ctx = { ...makeCtxWithOptions({ persistentAuthState: OPAQUE_STATE }), credentials };
    const seen = await captureStrategyCreds(ctx);
    expect(seen[0]).toHaveProperty('otpLongTermToken', 'ltt-onezero-stored');
  });
});

describe('persistent-auth option redaction', () => {
  it.each(PERSISTENT_OPTION_NAMES)('lists %s among the redacted paths', name => {
    expect([...SENSITIVE_PATHS]).toContain(name);
  });

  it('keeps the opaque state out of the production log stream', () => {
    const output = logThroughProductionRedaction({ persistentAuthState: OPAQUE_STATE });
    expect(output).not.toContain(OPAQUE_STATE);
  });
});
