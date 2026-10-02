/**
 * Pepper durable device-auth — mocked end-to-end through `createScraper`.
 *
 * The synthetic Transmit server verifies every signed request with
 * `crypto.verify` against the device key it registered, so these runs prove
 * the wire contract, not just the wiring:
 *
 *   - enrollment: bind + password + one SMS, one state publication;
 *   - fresh replay: zero auth requests;
 *   - expired resume: signed login + password only — no bind, no SMS;
 *   - every durable failure: no bind, no SMS, no cold fallback, no secret in
 *     the caller-visible error.
 *
 * Rule #18: every value is synthetic; device keys are generated per test.
 */

import type { KeyObject } from 'node:crypto';
import { generateKeyPairSync, sign } from 'node:crypto';

import { CompanyTypes } from '../../../Definitions.js';
import type { ScraperScrapingResult } from '../../../Scrapers/Base/Interface.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import type {
  IMockCallCounts,
  IMockHandle,
  IPepperMockOptions,
} from '../Pepper/PepperFetchMock.js';
import { installPepperFetchMock, PEPPER_MOCK_CREDS } from '../Pepper/PepperFetchMock.js';
import type { IBoundDevice, IStateStore } from '../Pepper/PepperPersistentAuthFixtures.js';
import {
  decodeDurable,
  durableCreds,
  makeBoundDevice,
  makeStateStore,
  syntheticJwt,
} from '../Pepper/PepperPersistentAuthFixtures.js';
import { canonicalOf, keyIdOf } from '../Pepper/PepperSignatureOracle.js';

/** Fixed window before the mock's synthetic rows (see PepperFetchMock.ts). */
const START_DATE = new Date('2026-01-01');

/** Per-scrape budget: the offline pipeline takes ~12 s per run here. */
const ONE_RUN_MS = 60000;
const TWO_RUNS_MS = 120000;

/** Synthetic OTP the fake retriever answers with. */
const FAKE_OTP = 'fixt-otp-pep-3e9d';

/** Every SMS prompt the pipeline raised during the current test. */
const OTP_PROMPTS: string[] = [];

/** Every onAuthFlowComplete invocation during the current test. */
const AUTH_FLOW_EVENTS: unknown[] = [];

/**
 * OTP retriever that records being asked.
 * @param phoneHint - Masked phone the pipeline would have texted.
 * @returns Synthetic code.
 */
function recordingOtpRetriever(phoneHint: string): Promise<string> {
  OTP_PROMPTS.push(phoneHint);
  return Promise.resolve(FAKE_OTP);
}

/**
 * Zero-arg OTP retriever matching the credentials-side contract.
 * @returns Synthetic code, recorded so the test can count SMS prompts.
 */
function credsOtpRetriever(): Promise<string> {
  return recordingOtpRetriever('creds');
}

/**
 * Legacy auth-flow hook — durable mode must never invoke it.
 * @param info - Hook payload.
 * @returns Resolves immediately.
 */
function recordingAuthFlowHook(info: unknown): Promise<void> {
  AUTH_FLOW_EVENTS.push(info);
  return Promise.resolve();
}

/** One durable scrape's inputs. */
interface IDurableRun {
  readonly store: IStateStore;
  readonly state?: string;
}

/**
 * Run one durable Pepper scrape against the installed mock.
 * @param run - State store plus optional stored state.
 * @returns Scrape result.
 */
async function scrapeDurable(run: IDurableRun): Promise<ScraperScrapingResult> {
  const stateOption = run.state === undefined ? {} : { persistentAuthState: run.state };
  const scraper = createScraper({
    companyId: CompanyTypes.Pepper,
    startDate: START_DATE,
    otpCodeRetriever: recordingOtpRetriever,
    onAuthFlowComplete: recordingAuthFlowHook,
    onPersistentAuthStateUpdate: run.store.onUpdate,
    ...stateOption,
  });
  const creds = durableCreds(credsOtpRetriever);
  return scraper.scrape(creds);
}

/**
 * Pin the zero-cost legacy channels: durable mode never uses them.
 * @param result - Scrape result.
 * @returns True once asserted.
 */
function expectNoLegacyChannels(result: ScraperScrapingResult): true {
  expect(AUTH_FLOW_EVENTS).toEqual([]);
  expect(result.persistentOtpToken).toBeUndefined();
  return true;
}

/** Auth-route counts a scenario expects (identity = their sum). */
type RouteExpectation = Pick<
  IMockCallCounts,
  'bind' | 'login' | 'assertPassword' | 'assertOtp' | 'rejected' | 'unknownAuth'
>;

/** No auth request at all. */
const NO_AUTH: RouteExpectation = {
  bind: 0,
  login: 0,
  assertPassword: 0,
  assertOtp: 0,
  rejected: 0,
  unknownAuth: 0,
};

/**
 * Assert the exact auth-route counts of a handle.
 * @param handle - Installed mock.
 * @param expected - Expected per-route counts.
 * @returns True once asserted.
 */
function expectRoutes(handle: IMockHandle, expected: RouteExpectation): true {
  const counts = handle.callCounts();
  expect(counts).toMatchObject(expected);
  return true;
}

let handle: IMockHandle | undefined;

/**
 * Install the Pepper mock for the current test.
 * @param options - Server behaviour.
 * @returns Installed handle.
 */
function install(options: IPepperMockOptions): IMockHandle {
  handle = installPepperFetchMock(options);
  return handle;
}

beforeEach(() => {
  OTP_PROMPTS.length = 0;
  AUTH_FLOW_EVENTS.length = 0;
});

afterEach(() => {
  handle?.dispose();
  handle = undefined;
});

describe('Pepper durable auth — success paths (mocked E2E)', () => {
  it(
    'enrollment binds once, spends one SMS, publishes once, and the state replays offline',
    async () => {
      const issued = syntheticJwt(3600, 'syn-enrolled');
      const mock = install({ issuedToken: issued });
      const store = makeStateStore();
      const enrolled = await scrapeDurable({ store });
      expect(enrolled.success).toBe(true);
      const enrollRoutes = { ...NO_AUTH, bind: 1, assertPassword: 1, assertOtp: 1 };
      expectRoutes(mock, enrollRoutes);
      expect(OTP_PROMPTS).toHaveLength(1);
      expect(store.invocations).toBe(1);
      expectNoLegacyChannels(enrolled);
      const published = decodeDurable(store.published[0]);
      expect(published.state).toMatchObject({ accessToken: issued, deviceId: 'syn-device-id' });
      const replayed = await scrapeDurable({ store, state: store.published[0] });
      expect(replayed.success).toBe(true);
      expectRoutes(mock, enrollRoutes);
      expect(OTP_PROMPTS).toHaveLength(1);
      expect(store.invocations).toBe(1);
      const finalCounts = mock.callCounts();
      expect(finalCounts.graphqlRejected).toBe(0);
    },
    TWO_RUNS_MS,
  );

  it(
    'a fresh stored state replays with zero auth requests and no publication',
    async () => {
      const stored = syntheticJwt(3600, 'syn-stored');
      const device = makeBoundDevice(stored);
      const mock = install({ devices: [device.server], acceptedTokens: [stored] });
      const store = makeStateStore();
      const result = await scrapeDurable({ store, state: device.encoded });
      expect(result.success).toBe(true);
      expectRoutes(mock, NO_AUTH);
      const counts = mock.callCounts();
      expect(counts).toMatchObject({ identity: 0, graphqlRejected: 0 });
      expect(counts.graphql).toBeGreaterThanOrEqual(3);
      expect(OTP_PROMPTS).toEqual([]);
      expect(store.invocations).toBe(0);
      expectNoLegacyChannels(result);
    },
    ONE_RUN_MS,
  );

  it(
    'an expired state renews with signed login + password only, then replays offline',
    async () => {
      const expired = syntheticJwt(-60, 'syn-expired');
      const renewed = syntheticJwt(3600, 'syn-renewed');
      const device = makeBoundDevice(expired);
      const mock = install({ issuedToken: renewed, devices: [device.server] });
      const store = makeStateStore();
      const result = await scrapeDurable({ store, state: device.encoded });
      expect(result.success).toBe(true);
      const resumeRoutes = { ...NO_AUTH, login: 1, assertPassword: 1 };
      expectRoutes(mock, resumeRoutes);
      expect(OTP_PROMPTS).toEqual([]);
      expect(store.invocations).toBe(1);
      expectNoLegacyChannels(result);
      const published = decodeDurable(store.published[0]);
      expect(published.state).toEqual({
        version: 1,
        provider: 'pepper',
        account: device.server.uid,
        clientInstanceId: device.server.clientInstanceId,
        deviceId: device.server.deviceId,
        accessToken: renewed,
        ecPrivateKeyPkcs8Base64: device.ecPrivateKeyPkcs8Base64,
      });
      const replayed = await scrapeDurable({ store, state: store.published[0] });
      expect(replayed.success).toBe(true);
      expectRoutes(mock, resumeRoutes);
      const finalCounts = mock.callCounts();
      expect(finalCounts.graphqlRejected).toBe(0);
    },
    TWO_RUNS_MS,
  );
});

/** One fail-closed scenario. */
interface IFailureCase {
  readonly label: string;
  readonly arrange: () => IArranged;
  readonly routes: RouteExpectation;
  readonly storeInvocations: number;
  readonly isGraphqlReached: boolean;
  readonly rejections: readonly string[];
}

/** What a failure scenario installs and runs with. */
interface IArranged {
  readonly options: IPepperMockOptions;
  readonly state: string;
  readonly store: IStateStore;
  readonly secrets: readonly string[];
}

/**
 * Every value that must never appear in a caller-visible error.
 * @param device - Device whose state was supplied.
 * @returns Secret and personal values.
 */
function secretsOf(device: IBoundDevice): readonly string[] {
  return [
    device.encoded,
    device.accessToken,
    device.ecPrivateKeyPkcs8Base64,
    device.server.clientInstanceId,
    device.server.deviceId,
    device.server.uid,
    PEPPER_MOCK_CREDS.password,
  ];
}

/**
 * Arrange an expired state whose renewal the server will see.
 * @param devices - Server-side registrations derived from the device.
 * @param failure - Optional state-store failure.
 * @returns Arranged scenario.
 */
function arrangeExpired(
  devices: (device: IBoundDevice) => IPepperMockOptions['devices'],
  failure?: Error,
): IArranged {
  const expired = syntheticJwt(-60, 'syn-expired');
  const renewed = syntheticJwt(3600, 'syn-renewed');
  const device = makeBoundDevice(expired);
  const options = { issuedToken: renewed, devices: devices(device) };
  const store = makeStateStore(failure);
  return { options, state: device.encoded, store, secrets: [...secretsOf(device), renewed] };
}

/**
 * Arrange a state the scraper must reject before any request.
 * @param state - Encoded state to supply.
 * @param device - Device the secrets come from.
 * @returns Arranged scenario.
 */
function arrangeRejectedState(state: string, device: IBoundDevice): IArranged {
  const store = makeStateStore();
  return { options: { devices: [device.server] }, state, store, secrets: secretsOf(device) };
}

/**
 * The stored device registered under a different key.
 * @param device - Caller-side device.
 * @returns Server registration with a foreign public key.
 */
function foreignKeyRegistration(device: IBoundDevice): IPepperMockOptions['devices'] {
  const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicKeyDer = other.publicKey.export({ type: 'spki', format: 'der' });
  return [{ ...device.server, publicKeyDer }];
}

/**
 * No server registration at all.
 * @returns Empty device list.
 */
function noRegistration(): IPepperMockOptions['devices'] {
  return [];
}

/**
 * The device registered exactly as the state describes it.
 * @param device - Caller-side device.
 * @returns Matching server registration.
 */
function ownRegistration(device: IBoundDevice): IPepperMockOptions['devices'] {
  return [device.server];
}

/**
 * Expired state for a device the server never bound.
 * @returns Arranged scenario.
 */
function arrangeUnknownDevice(): IArranged {
  return arrangeExpired(noRegistration);
}

/**
 * Expired state signing with a key other than the bound one.
 * @returns Arranged scenario.
 */
function arrangeForeignKey(): IArranged {
  return arrangeExpired(foreignKeyRegistration);
}

/**
 * Expired state whose renewal succeeds but cannot be stored.
 * @returns Arranged scenario.
 */
function arrangeStoreFailure(): IArranged {
  const failure = new Error('synthetic store failure');
  return arrangeExpired(ownRegistration, failure);
}

/**
 * A state string the codec cannot decode.
 * @returns Arranged scenario.
 */
function arrangeUndecodable(): IArranged {
  const stored = syntheticJwt(3600, 'syn-stored');
  const device = makeBoundDevice(stored);
  return arrangeRejectedState('not-a-durable-state', device);
}

/**
 * A well-formed state bound to another account.
 * @returns Arranged scenario.
 */
function arrangeOtherAccount(): IArranged {
  const stored = syntheticJwt(3600, 'syn-stored');
  const device = makeBoundDevice(stored, { account: '972000000001' });
  return arrangeRejectedState(device.encoded, device);
}

/**
 * A locally fresh token the server no longer accepts.
 * @returns Arranged scenario.
 */
function arrangeRevoked(): IArranged {
  const revoked = syntheticJwt(3600, 'syn-revoked');
  const device = makeBoundDevice(revoked);
  return arrangeRejectedState(device.encoded, device);
}

/** Login rejected by the server: one login attempt, one rejection. */
const LOGIN_REJECTED: RouteExpectation = { ...NO_AUTH, login: 1, rejected: 1 };

const FAILURE_CASES: readonly IFailureCase[] = [
  {
    label: 'the device is unknown to the server',
    arrange: arrangeUnknownDevice,
    routes: LOGIN_REJECTED,
    storeInvocations: 0,
    isGraphqlReached: false,
    rejections: ['login-unknown-device'],
  },
  {
    label: 'the state signs with a key the server never bound',
    arrange: arrangeForeignKey,
    routes: LOGIN_REJECTED,
    storeInvocations: 0,
    isGraphqlReached: false,
    rejections: ['login-signature'],
  },
  {
    label: 'the caller fails to store the renewed state',
    arrange: arrangeStoreFailure,
    routes: { ...NO_AUTH, login: 1, assertPassword: 1 },
    storeInvocations: 1,
    isGraphqlReached: false,
    rejections: [],
  },
  {
    label: 'the state is undecodable',
    arrange: arrangeUndecodable,
    routes: NO_AUTH,
    storeInvocations: 0,
    isGraphqlReached: false,
    rejections: [],
  },
  {
    label: 'the state belongs to another account',
    arrange: arrangeOtherAccount,
    routes: NO_AUTH,
    storeInvocations: 0,
    isGraphqlReached: false,
    rejections: [],
  },
  {
    label: 'the server revokes a locally fresh token mid-scrape',
    arrange: arrangeRevoked,
    routes: NO_AUTH,
    storeInvocations: 0,
    isGraphqlReached: true,
    rejections: [],
  },
];

describe('Pepper durable auth — every failure fails closed (mocked E2E)', () => {
  it.each(FAILURE_CASES)(
    'fails without bind, SMS or cold fallback when $label',
    async testCase => {
      const arranged = testCase.arrange();
      const mock = install(arranged.options);
      const result = await scrapeDurable({ store: arranged.store, state: arranged.state });
      expect(result.success).toBe(false);
      expectRoutes(mock, testCase.routes);
      expect(OTP_PROMPTS).toEqual([]);
      expect(arranged.store.invocations).toBe(testCase.storeInvocations);
      expect(arranged.store.published).toEqual([]);
      expectNoLegacyChannels(result);
      const counts = mock.callCounts();
      expect(counts.graphql > 0).toBe(testCase.isGraphqlReached);
      expect(counts.graphqlRejected).toBe(counts.graphql);
      expect(counts.rejections).toEqual(testCase.rejections);
      const visible = `${result.errorType ?? ''} ${result.errorMessage ?? ''}`;
      const leaked = arranged.secrets.filter((secret): boolean => visible.includes(secret));
      expect(leaked).toEqual([]);
    },
    ONE_RUN_MS,
  );
});

/** Public Transmit client identifier the server requires on every route. */
const TS_TOKEN = 'TSToken 7cf2d7a7-681d-450a-ab23-06e48d2b8fd6; tid=digital_client_token_token';

/** Bind URL the synthetic server routes. */
const BIND_URL = 'https://sa.pepper.co.il/api/v2/auth/bind?aid=DIGITAL_BLL&locale=en-US&tsm=1';

/** A bind request the test signs itself. */
interface IHandSigned {
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
}

/**
 * Sign a canonical string the way the protocol describes.
 * @param privateKey - Device private key.
 * @param spki - Device public key (SPKI DER) for the key-id.
 * @param canonical - Canonical string.
 * @returns `Content-Signature` header value.
 */
function signatureHeader(privateKey: KeyObject, spki: Buffer, canonical: string): string {
  const payload = Buffer.from(canonical, 'utf8');
  const signature = sign('sha256', payload, { key: privateKey, dsaEncoding: 'der' });
  const keyId = keyIdOf(spki);
  return `data:${signature.toString('base64')};key-id:${keyId};scheme:4`;
}

/**
 * Build and sign a bind body with a fresh key, independent of production.
 * @param tamper - Rewrites the body after signing (identity when honest).
 * @returns Headers + body to POST.
 */
function handSignedBind(tamper: (bodyText: string) => string): IHandSigned {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = pair.publicKey.export({ type: 'spki', format: 'der' });
  const data = { public_key: { key: spki.toString('base64'), type: 'ec' }, params: {} };
  const bodyText = JSON.stringify({ headers: [{ type: 'uid', uid: 'syn-uid' }], data });
  const base = { authorization: TS_TOKEN, 'X-TS-Client-Version': 'syn-1.0' };
  const canonical = canonicalOf({ url: BIND_URL, headers: base, bodyText });
  const header = signatureHeader(pair.privateKey, spki, canonical);
  const tampered = tamper(bodyText);
  return { headers: { ...base, 'Content-Signature': header }, bodyText: tampered };
}

/**
 * POST a request through the installed mock fetch.
 * @param url - Target URL.
 * @param request - Headers + body.
 * @returns HTTP status.
 */
async function post(url: string, request: IHandSigned): Promise<number> {
  const init = { method: 'POST', headers: request.headers, body: request.bodyText };
  const response = await fetch(url, init);
  return response.status;
}

/**
 * Leave the body as signed.
 * @param bodyText - Signed body.
 * @returns Same body.
 */
function honest(bodyText: string): string {
  return bodyText;
}

/**
 * Change one byte of meaning after signing.
 * @param bodyText - Signed body.
 * @returns Body naming a different uid.
 */
function swapUid(bodyText: string): string {
  return bodyText.replace('syn-uid', 'syn-other');
}

describe('Pepper mock — the server contract is enforced, not assumed', () => {
  it('accepts an honestly signed bind', async () => {
    const mock = install({});
    const request = handSignedBind(honest);
    const status = await post(BIND_URL, request);
    expect(status).toBe(200);
    const counts = mock.callCounts();
    expect(counts).toMatchObject({ bind: 1, rejected: 0 });
  });

  it('rejects a bind whose body changed after signing', async () => {
    const mock = install({});
    const request = handSignedBind(swapUid);
    const status = await post(BIND_URL, request);
    expect(status).toBe(401);
    const counts = mock.callCounts();
    expect(counts).toMatchObject({ bind: 1, rejected: 1, rejections: ['bind-signature'] });
  });

  it('rejects a bind without the public TSToken', async () => {
    const mock = install({});
    const signed = handSignedBind(honest);
    const request = { ...signed, headers: { ...signed.headers, authorization: 'TSToken other' } };
    const status = await post(BIND_URL, request);
    expect(status).toBe(401);
    const counts = mock.callCounts();
    expect(counts).toMatchObject({ bind: 0, rejected: 1, rejections: ['ts-token'] });
  });

  it('answers 404 to an auth route it does not serve', async () => {
    const mock = install({});
    const request = handSignedBind(honest);
    const status = await post('https://sa.pepper.co.il/api/v2/auth/unknown?aid=x', request);
    expect(status).toBe(404);
    const counts = mock.callCounts();
    expect(counts).toMatchObject({ unknownAuth: 1, rejected: 0, identity: 1 });
  });
});
