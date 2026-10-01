/**
 * Persistent-auth secrets never reach an error message or a log line.
 *
 * Every pipeline logger is swapped for a real pino logger at `trace` level with
 * the production redaction config, so enrollment, replay, renewal and each
 * durable failure are observed at full verbosity through the real resolver
 * ladder. A static scan keeps real-looking secrets out of the durable fixtures.
 */

import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';

import { jest } from '@jest/globals';
import pino, { type Logger, type LoggerOptions } from 'pino';

/** Every serialized log line any pipeline module emitted. */
const LOG_LINES: string[] = [];

/**
 * Real pino logger at `trace`, production redaction, deterministic output.
 * @param production - Production pino options (redaction + mixin).
 * @returns Logger whose lines land in {@link LOG_LINES}.
 */
function makeCapturingLogger(production: LoggerOptions): Logger {
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer): number => {
    const line = chunk.toString();
    return LOG_LINES.push(line);
  });
  const options = { ...production, level: 'trace', timestamp: false, base: undefined };
  return pino(options, stream);
}

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Logging/Debug.js', async () => {
  const bankContext = await import('../../../../../Scrapers/Pipeline/Logging/BankContext.js');
  const root = await import('../../../../../Scrapers/Pipeline/Logging/RootLogger.js');
  const production = root.buildSilentOptions();
  const logger = makeCapturingLogger(production);
  /**
   * Every pipeline module shares the capturing logger.
   * @returns The capturing logger.
   */
  const getDebug = (): Logger => logger;
  return { ...bankContext, getDebug, getDebugByName: getDebug };
});

const FIXTURES = await import('./Flow/DurableAuthFixtures.js');
const STUB = await import('./Flow/StubMediator.js');
const WARM = await import('./Flow/WarmStartFixtures.js');
const RESOLVER =
  await import('../../../../../Scrapers/Pipeline/Mediator/Api/TokenResolverBuilder.js');

type Fixture = Awaited<typeof FIXTURES>;
type StoredFixture = ReturnType<Fixture['makeStoredState']>;
type ScriptedResponse = ReturnType<Fixture['tokenResponse']>;
type DurableMode = Parameters<Fixture['makeDurableStrategy']>[1];
type CallConfig = Awaited<ReturnType<Fixture['loadPepperConfig']>>;

const FRESH_JWT = WARM.makeJwt(3600);
const EXPIRED_JWT = WARM.makeJwt(-60);
const RENEWED_JWT = WARM.makeJwt(7200);
const OTP_CODE = 'syn-otp-864209';

/** One durable run: what is stored, what the server answers, how the store behaves. */
interface IScenario {
  readonly label: string;
  readonly responses: readonly ScriptedResponse[];
  readonly stored?: StoredFixture;
  readonly encodedOverride?: string;
  readonly account?: string;
  readonly isStoreFailing?: boolean;
}

/** Everything a run could leak, and everything it emitted. */
interface IObservedRun {
  readonly secrets: readonly string[];
  readonly emitted: string;
}

let config: CallConfig;

beforeAll(async (): Promise<void> => {
  FIXTURES.registerPepperAuthUrls();
  config = await FIXTURES.loadPepperConfig();
});

beforeEach((): void => {
  LOG_LINES.length = 0;
});

/**
 * State callback that records the state it is handed, then rejects with text
 * echoing it — the worst-case caller error a failure message could surface.
 * @param handed - Receives every state the strategy tried to store.
 * @returns Rejecting callback.
 */
function makeEchoingFailedStore(handed: string[]): (state: string) => Promise<void> {
  return async (state: string): Promise<void> => {
    handed.push(state);
    await Promise.resolve();
    throw new TypeError(`disk full while storing ${state}`);
  };
}

/**
 * Build the durable mode a scenario describes.
 * @param scenario - Scenario.
 * @param onUpdate - State callback.
 * @returns Durable mode.
 */
function modeOf(scenario: IScenario, onUpdate: (state: string) => Promise<void>): DurableMode {
  const account = scenario.account ?? FIXTURES.PEPPER_ACCOUNT;
  const base = { block: FIXTURES.pepperBlock(config), onUpdate, account };
  if (scenario.stored === undefined) return { kind: 'enroll', ...base };
  const encodedState = scenario.encodedOverride ?? scenario.stored.encoded;
  return { kind: 'resume', ...base, encodedState };
}

/**
 * Every string field of a state, plus its encoded form.
 * @param encoded - Encoded state.
 * @returns Secret values the state carries.
 */
function secretsOfEncoded(encoded: string): readonly string[] {
  const { state } = FIXTURES.decodePublished(encoded);
  const fields = [state.accessToken, state.ecPrivateKeyPkcs8Base64, state.clientInstanceId];
  return [encoded, ...fields, state.deviceId];
}

/**
 * Secrets the caller supplied before the run.
 * @param scenario - Scenario.
 * @returns Secret values.
 */
function suppliedSecrets(scenario: IScenario): readonly string[] {
  const account = scenario.account ?? FIXTURES.PEPPER_ACCOUNT;
  const caller = [
    account,
    FIXTURES.PEPPER_ACCOUNT,
    FIXTURES.PEPPER_PASSWORD,
    OTP_CODE,
    RENEWED_JWT,
  ];
  if (scenario.stored === undefined) return caller;
  const encoded = scenario.encodedOverride ?? scenario.stored.encoded;
  const storedSecrets = secretsOfEncoded(scenario.stored.encoded);
  return [...caller, encoded, ...storedSecrets];
}

/**
 * Resolve one scenario's strategy through the real resolver ladder.
 * @param scenario - Scenario.
 * @param onUpdate - State callback.
 * @returns Error message, or '' on success.
 */
async function resolveScenario(
  scenario: IScenario,
  onUpdate: (state: string) => Promise<void>,
): Promise<string> {
  const mode = modeOf(scenario, onUpdate);
  const strategy = FIXTURES.makeDurableStrategy(config, mode);
  const bus = STUB.makeStubMediator({ responses: scenario.responses, captures: [] });
  const creds = FIXTURES.pepperCreds(async (): Promise<string> => Promise.resolve(OTP_CODE));
  const ctx = FIXTURES.PEPPER_CTX;
  const result = await RESOLVER.buildResolverFromStrategy({ strategy, bus, ctx, creds }).resolve();
  return result.success ? '' : result.errorMessage;
}

/**
 * Resolve one scenario and collect everything it could leak and emitted.
 * @param scenario - Scenario.
 * @returns Secrets in play and every emitted byte (error message + log lines).
 */
async function observe(scenario: IScenario): Promise<IObservedRun> {
  const recorder = FIXTURES.makeRecorder();
  const failedStore = makeEchoingFailedStore(recorder.invocations);
  const onUpdate = scenario.isStoreFailing === true ? failedStore : recorder.onUpdate;
  const message = await resolveScenario(scenario, onUpdate);
  const published = recorder.invocations.flatMap(secretsOfEncoded);
  const supplied = suppliedSecrets(scenario);
  const emitted = [message, ...LOG_LINES].join('\n');
  return { secrets: [...supplied, ...published], emitted };
}

/**
 * Secrets that appear in the emitted text.
 * @param run - Observed run.
 * @returns Leaked values (empty when clean).
 */
function leaksOf(run: IObservedRun): readonly string[] {
  return run.secrets.filter((secret): boolean => run.emitted.includes(secret));
}

const STORED_FRESH = FIXTURES.makeStoredState(FRESH_JWT);
const STORED_EXPIRED = FIXTURES.makeStoredState(EXPIRED_JWT);
const LOGIN_OK = FIXTURES.loginResponse();
const ENROLL_OK = FIXTURES.enrollResponses(RENEWED_JWT);
const RENEW_OK = FIXTURES.resumeResponses(RENEWED_JWT);
const LOGIN_401 = FIXTURES.transportFailure('HTTP 401');
const ASSERT_403 = FIXTURES.transportFailure('HTTP 403');
const MALFORMED_TOKEN = FIXTURES.tokenResponse('not-a-jwt');
const CORRUPTED_STATE = STORED_EXPIRED.encoded.slice(0, -4);

const SCENARIOS: readonly IScenario[] = [
  { label: 'enrollment', responses: ENROLL_OK },
  { label: 'fresh replay', responses: [], stored: STORED_FRESH },
  { label: 'expired renewal', responses: RENEW_OK, stored: STORED_EXPIRED },
  { label: 'a 401 on login', responses: [LOGIN_401], stored: STORED_EXPIRED },
  { label: 'a 403 on assert', responses: [LOGIN_OK, ASSERT_403], stored: STORED_EXPIRED },
  {
    label: 'a malformed replacement token',
    responses: [LOGIN_OK, MALFORMED_TOKEN],
    stored: STORED_EXPIRED,
  },
  {
    label: 'a store that rejects a renewed state',
    responses: RENEW_OK,
    stored: STORED_EXPIRED,
    isStoreFailing: true,
  },
  { label: 'a store that rejects an enrolled state', responses: ENROLL_OK, isStoreFailing: true },
  {
    label: 'a corrupted state',
    responses: [],
    stored: STORED_EXPIRED,
    encodedOverride: CORRUPTED_STATE,
  },
  {
    label: 'a state of another account',
    responses: [],
    stored: STORED_FRESH,
    account: '0509999999',
  },
];

describe('persistent-auth secrets stay out of errors and trace logs', () => {
  it.each(SCENARIOS)('$label emits no secret', async scenario => {
    const run = await observe(scenario);
    const leaked = leaksOf(run);
    expect(leaked).toEqual([]);
  });

  it('captures pipeline trace output, so a clean result is not vacuous', async () => {
    const run = await observe(SCENARIOS[2]);
    expect(run.emitted).toContain('"urlTag":"auth.login"');
    expect(run.emitted).toContain('"urlTag":"auth.assert"');
  });

  it('logs the in-run renewal refusal without a secret', async () => {
    const mode = modeOf(SCENARIOS[2], FIXTURES.makeRecorder().onUpdate);
    const strategy = FIXTURES.makeDurableStrategy(config, mode);
    const bus = STUB.makeStubMediator({ responses: [], captures: [] });
    await strategy.primeFresh(bus, FIXTURES.PEPPER_CTX, {});
    const emitted = LOG_LINES.join('\n');
    const leaked = secretsOfEncoded(STORED_EXPIRED.encoded).filter(s => emitted.includes(s));
    expect(emitted).toContain('refuses an in-run renewal');
    expect(leaked).toEqual([]);
  });

  it('redacts stored values a renewal failure quotes back', async () => {
    const { deviceId, clientInstanceId, accessToken } = STORED_EXPIRED.state;
    const echoed = `401: {"did":"${deviceId}","cid":"${clientInstanceId}","jwt":"${accessToken}"}`;
    const failure = FIXTURES.transportFailure(`POST https://sa.pepper.co.il/x ${echoed}`);
    const scenario = { label: 'echo', responses: [failure], stored: STORED_EXPIRED };
    const message = await resolveScenario(scenario, FIXTURES.makeRecorder().onUpdate);
    const leaked = secretsOfEncoded(STORED_EXPIRED.encoded).filter(s => message.includes(s));
    expect(leaked).toEqual([]);
    expect(message).toContain('POST https://sa.pepper.co.il/x 401: {"did":"[REDACTED]"');
  });
});

/** Durable-auth test sources that must hold only synthetic secrets. */
const DURABLE_SOURCES = [
  'src/Tests/E2eMocked/ApiDirect/PepperDurableAuth.e2e-mocked.test.ts',
  'src/Tests/E2eMocked/Pepper/PepperAuthServer.ts',
  'src/Tests/E2eMocked/Pepper/PepperFetchMock.ts',
  'src/Tests/E2eMocked/Pepper/PepperPersistentAuthFixtures.ts',
  'src/Tests/E2eMocked/Pepper/PepperSignatureOracle.ts',
  'src/Tests/E2eReal/Pepper.e2e-real.test.ts',
  'src/Tests/E2eReal/PepperDurableHarness.ts',
  'src/Tests/E2eReal/PepperDurableState.ts',
  'src/Tests/Unit/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActionsPersistentAuth.test.ts',
  'src/Tests/Unit/Pipeline/Mediator/ApiDirectCall/Flow/DurableAuthFixtures.ts',
  'src/Tests/Unit/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyPersistentAuth.test.ts',
  'src/Tests/Unit/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyPersistentAuthFailures.test.ts',
  'src/Tests/Unit/Pipeline/Mediator/ApiDirectCall/PersistentAuthInput.test.ts',
  'src/Tests/Unit/Pipeline/Mediator/ApiDirectCall/PersistentAuthSecurity.test.ts',
  'src/Tests/Unit/Pipeline/Mediator/ApiDirectCall/PersistentAuthStateCodec.test.ts',
  'src/Tests/Unit/PepperPersistentAuthHarness.test.ts',
] as const;

/** Synthetic Israeli mobile numbers the durable tests may use. */
const SYNTHETIC_PHONES = new Set([
  '0501234567',
  '0507654321',
  '0509999999',
  '+972500000017',
  '972500000017',
]);

const PEM_BLOCK = /-----BEGIN [A-Z ]+-----/;
const JWT_LITERAL = /eyJ[\w-]{8,}\.eyJ[\w-]{8,}\./;
const ISRAELI_MOBILE = /(?<!\d)(?:\+?972|0)5\d{8}(?!\d)/g;

/**
 * Read a repository source file.
 * @param relativePath - Path from the repository root.
 * @returns File text.
 */
function readSource(relativePath: string): string {
  const url = new URL(`../../../../../../${relativePath}`, import.meta.url);
  return readFileSync(url, 'utf8');
}

describe('durable-auth test sources hold only synthetic secrets', () => {
  it.each(DURABLE_SOURCES)('%s embeds no key, token or real phone number', relativePath => {
    const text = readSource(relativePath);
    const phones = text.match(ISRAELI_MOBILE) ?? [];
    const unknownPhones = phones.filter((phone): boolean => !SYNTHETIC_PHONES.has(phone));
    const hasPem = PEM_BLOCK.test(text);
    const hasJwt = JWT_LITERAL.test(text);
    expect(hasPem).toBe(false);
    expect(hasJwt).toBe(false);
    expect(unknownPhones).toEqual([]);
  });
});
