/**
 * Shared fixtures for the durable (persistent-auth) token-strategy tests.
 *
 * Uses Pepper's real call config, so a config edit that breaks the durable
 * paths fails these tests. Responses are synthetic Pepper `/auth/*` bodies, the
 * stored device key is a real P-256 key, and the state callback records every
 * publish in order. Zero network.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
} from 'node:crypto';

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type {
  IApiDirectCallConfig,
  IPersistentAuthConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type {
  GenericCreds,
  IConfigTokenStrategy,
  PersistentAuthMode,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import { createTokenStrategyFromConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import {
  decodePersistentAuthState,
  encodePersistentAuthState,
  type IPersistentAuthStateV1,
  type IRehydratedPersistentAuth,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/PersistentAuthStateCodec.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { IApiPostCapture } from './StubMediator.js';

/** Module shape of the Pepper call-config literal. */
interface IPepperConfigModule {
  readonly default: IApiDirectCallConfig;
}

/** A stored state plus its encoded, opaque form. */
interface IStoredFixture {
  readonly state: IPersistentAuthStateV1;
  readonly encoded: string;
}

/** Records every state callback and publish, plus test-side events, in order. */
interface IStateRecorder {
  readonly invocations: string[];
  readonly published: string[];
  readonly events: string[];
  readonly onUpdate: (state: string) => Promise<void>;
}

/** Normalized Pepper account the fixtures bind state to. */
const PEPPER_ACCOUNT = '0501234567';

/** Device id the synthetic bind response assigns. */
const BOUND_DEVICE_ID = 'dev-1';

/** Caller password the fixtures send — asserted to reach the assertion. */
const PEPPER_PASSWORD = 'pw-fixture';

/** Pipeline-context stub — only companyId matters. */
const PEPPER_CTX = { companyId: CompanyTypes.Pepper } as unknown as IPipelineContext;

/** Identity every fixture state is encoded against. */
const PEPPER_EXPECTATION = { provider: 'pepper', account: PEPPER_ACCOUNT };

/**
 * Point Pepper's auth URL tags at inert test URLs.
 * @returns True once registered.
 */
function registerPepperAuthUrls(): boolean {
  registerWkUrl('auth.bind', CompanyTypes.Pepper, 'https://pepper.test/auth/bind');
  registerWkUrl('auth.assert', CompanyTypes.Pepper, 'https://pepper.test/auth/assert');
  registerWkUrl('auth.login', CompanyTypes.Pepper, 'https://pepper.test/auth/login');
  return true;
}

/**
 * Load Pepper's call config (dynamic — Registry/Config is DI-restricted).
 * @returns Pepper IApiDirectCallConfig.
 */
async function loadPepperConfig(): Promise<IApiDirectCallConfig> {
  const path = '../../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigPepper.js';
  const mod = (await import(path)) as IPepperConfigModule;
  return mod.default;
}

/**
 * Read Pepper's persistent-auth block, failing the test when it is absent.
 * @param config - Pepper config.
 * @returns The declared block.
 */
function pepperBlock(config: IApiDirectCallConfig): IPersistentAuthConfig {
  const block = config.persistentAuth;
  if (block === undefined) throw new ScraperError('Pepper declares no persistentAuth block');
  return block;
}

/**
 * Synthetic `/auth/bind` success: session + device headers, password policy.
 * @returns Scripted response.
 */
function bindResponse(): Procedure<unknown> {
  const headers = [
    { type: 'session_id', session_id: 'sid-bind' },
    { type: 'device_id', device_id: BOUND_DEVICE_ID },
  ];
  const methods = [{ type: 'password', assertion_id: 'pwd-bind' }];
  const data = { challenge: 'ch-bind', control_flow: [{ type: 'authentication', methods }] };
  return succeed({ headers, data });
}

/**
 * Synthetic enrollment password assertion: offers the SMS channel.
 * @returns Scripted response.
 */
function passwordAssertResponse(): Procedure<unknown> {
  const channels = [{ type: 'sms', assertion_id: 'sms-1' }];
  return succeed({ data: { control_flow: [{ methods: [{ channels }] }] } });
}

/**
 * Synthetic `/auth/login` response on a bound device.
 * @param methods - Policy methods (default: one password method).
 * @returns Scripted response.
 */
function loginResponse(
  methods: readonly object[] = [{ type: 'password', assertion_id: 'pwd-login' }],
): Procedure<unknown> {
  const headers = [{ type: 'session_id', session_id: 'sid-login' }];
  const data = { challenge: 'ch-login', control_flow: [{ type: 'authentication', methods }] };
  return succeed({ headers, data });
}

/**
 * Synthetic assertion completion carrying a token.
 * @param token - Token value the bank returns.
 * @returns Scripted response.
 */
function tokenResponse(token: string): Procedure<unknown> {
  return succeed({ data: { token } });
}

/**
 * Transport-level failure as the mediator reports it.
 * @param message - Failure message.
 * @returns Scripted failure.
 */
function transportFailure(message: string): Procedure<unknown> {
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * The full enrollment script: bind, password assertion, OTP assertion.
 * @param token - JWT the OTP assertion returns.
 * @returns Scripted responses.
 */
function enrollResponses(token: string): Procedure<unknown>[] {
  return [bindResponse(), passwordAssertResponse(), tokenResponse(token)];
}

/**
 * The full renewal script: login, password assertion.
 * @param token - JWT the password assertion returns.
 * @returns Scripted responses.
 */
function resumeResponses(token: string): Procedure<unknown>[] {
  return [loginResponse(), tokenResponse(token)];
}

/**
 * Build and encode a stored Pepper state around a real P-256 device key.
 * @param accessToken - Stored JWT.
 * @returns State plus its encoded form.
 */
function makeStoredState(accessToken: string): IStoredFixture {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pkcs8 = pair.privateKey.export({ type: 'pkcs8', format: 'der' });
  const identity = { clientInstanceId: randomUUID(), deviceId: 'dev-stored' };
  const keyText = { accessToken, ecPrivateKeyPkcs8Base64: pkcs8.toString('base64') };
  const state = { version: 1, ...PEPPER_EXPECTATION, ...identity, ...keyText } as const;
  const encoded = encodePersistentAuthState(state, PEPPER_EXPECTATION);
  if (!isOk(encoded)) throw new ScraperError(encoded.errorMessage);
  return { state, encoded: encoded.value };
}

/**
 * Decode a published state against the fixture identity.
 * @param encoded - Published opaque state.
 * @returns Rehydrated state and key.
 */
function decodePublished(encoded: string): IRehydratedPersistentAuth {
  const decoded = decodePersistentAuthState(encoded, PEPPER_EXPECTATION);
  if (!isOk(decoded)) throw new ScraperError(decoded.errorMessage);
  return decoded.value;
}

/**
 * Yield to the event loop: every pending microtask runs first.
 * @returns True once the next macrotask fires.
 */
async function yieldToEventLoop(): Promise<true> {
  /**
   * Schedule the resolver as the next macrotask.
   * @param resolve - Resolver for the outer promise.
   * @returns Immediate handle.
   */
  const schedule = (resolve: (value: true) => unknown): unknown => {
    /**
     * Resolve the outer promise.
     * @returns True.
     */
    const fire = (): boolean => {
      resolve(true);
      return true;
    };
    return globalThis.setImmediate(fire);
  };
  return new Promise<true>(schedule);
}

/**
 * Recording state callback. Invocations are recorded on entry, so even an
 * un-awaited call is seen; publishes are recorded after an event-loop turn, so
 * a caller that did not await the callback returns first and fails ordering.
 * @returns Recorder.
 */
function makeRecorder(): IStateRecorder {
  const invocations: string[] = [];
  const published: string[] = [];
  const events: string[] = [];
  /**
   * Store the state after an event-loop turn.
   * @param state - Opaque state.
   * @returns Resolves once recorded.
   */
  const onUpdate = async (state: string): Promise<void> => {
    invocations.push(state);
    await yieldToEventLoop();
    published.push(state);
    events.push('published');
  };
  return { invocations, published, events, onUpdate };
}

/**
 * Build the strategy for a durable mode, failing the test on a factory error.
 * @param config - Bank config.
 * @param mode - Persistent-auth mode.
 * @returns Strategy.
 */
function makeDurableStrategy(
  config: IApiDirectCallConfig,
  mode: PersistentAuthMode,
): IConfigTokenStrategy {
  const created = createTokenStrategyFromConfig({ config, persistentAuth: mode });
  if (!isOk(created)) throw new ScraperError(created.errorMessage);
  return created.value;
}

/**
 * Pepper creds as the caller supplies them.
 * @param otpCodeRetriever - OTP retriever spy.
 * @returns Credentials.
 */
function pepperCreds(otpCodeRetriever: () => Promise<string>): GenericCreds {
  return { phoneNumber: PEPPER_ACCOUNT, password: PEPPER_PASSWORD, otpCodeRetriever };
}

/**
 * Read a `body.data` field from a captured request.
 * @param capture - Captured request.
 * @returns The `body.data` object.
 */
function bodyData(capture: IApiPostCapture): Readonly<Record<string, unknown>> {
  return capture.body.data as Readonly<Record<string, unknown>>;
}

/**
 * Read `body.data.params.CellPhoneID` from a captured request.
 * @param capture - Captured bind or login request.
 * @returns The client instance id the request sent.
 */
function cellPhoneIdOf(capture: IApiPostCapture): unknown {
  const params = bodyData(capture).params as Readonly<Record<string, unknown>>;
  return params.CellPhoneID;
}

/**
 * Key id a signature header names for the stored device key: SHA-256 of the
 * public key's SPKI DER, hex.
 * @param stored - Stored state.
 * @returns Expected key id.
 */
function storedKeyId(stored: IStoredFixture): string {
  const der = Buffer.from(stored.state.ecPrivateKeyPkcs8Base64, 'base64');
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spki).digest('hex');
}

/**
 * Key id named by a captured request's `Content-Signature` header.
 * @param capture - Captured signed request.
 * @returns Key id, or '' when the header is absent.
 */
function signatureKeyId(capture: IApiPostCapture): string {
  const header = capture.extraHeaders?.['Content-Signature'] ?? '';
  const match = /key-id:([\da-f]+)/.exec(header);
  return match?.[1] ?? '';
}

/**
 * URL tags of the captured requests, in order.
 * @param captures - Captured requests.
 * @returns Tags.
 */
function urlsOf(captures: readonly IApiPostCapture[]): readonly string[] {
  return captures.map((capture): string => String(capture.url));
}

export type { IStateRecorder, IStoredFixture };
export {
  bodyData,
  BOUND_DEVICE_ID,
  cellPhoneIdOf,
  decodePublished,
  enrollResponses,
  loadPepperConfig,
  loginResponse,
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
  tokenResponse,
  transportFailure,
  urlsOf,
};
