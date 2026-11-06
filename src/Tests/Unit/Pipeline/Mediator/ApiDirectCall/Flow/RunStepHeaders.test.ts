/**
 * Per-step header templates.
 *
 * A step's `headers` are hydrated against the step scope on every call, sent
 * as text, and replace a static header of the same name whatever its case.
 * The cookie jar and the signer set their headers last and replace a step or
 * static header of the same name whatever its case, so only one value is sent.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
  JsonValueTemplate,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IGenericKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import { generateKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import type { IRunStepArgs } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import {
  createSimpleCookieJar,
  runStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const HINT = CompanyTypes.OneZero;
const UUID_SHAPE = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
  staticHeaders: { 'X-Site': 'static', 'X-Keep': 'kept' },
};

const SIGNATURE_SHAPE = /^data:.+;key-id:[a-f0-9]+;scheme:4$/;

const SIGNED_CONFIG: IApiDirectCallConfig = {
  ...CONFIG,
  signer: {
    algorithm: 'ECDSA-P256',
    encoding: 'DER',
    headerName: 'X-Sig',
    schemeTag: 4,
    canonical: {
      parts: ['bodyJson'],
      separator: '%%',
      escapeFrom: '%%',
      escapeTo: String.raw`\%`,
      sortQueryParams: false,
      clientVersion: '1.2.3',
    },
  },
};

/** The config a call runs under and the jar or signing key it carries. */
interface IRunSetup {
  readonly config: IApiDirectCallConfig;
  readonly extras: Pick<IRunStepArgs, 'cookieJar' | 'signingKeypair'>;
}

const PLAIN: IRunSetup = { config: CONFIG, extras: {} };

/** What one step run resolves to. */
type RunResult = ReturnType<typeof runStep>;

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, 'https://example.test/api/bind');
});

/**
 * A bind step carrying the given header templates.
 * @param headers - Step header templates.
 * @returns Step config.
 */
function stepWith(headers: Readonly<Record<string, JsonValueTemplate>>): IStepConfig {
  return { name: 'bind', urlTag: 'auth.bind', body: { shape: {} }, headers, extractsToCarry: {} };
}

/**
 * Run a step once on a stub bus that answers OK.
 * @param step - Step config.
 * @param sink - Capture slot for the POST.
 * @param setup - Config, jar and signing key for the call.
 * @returns The step result.
 */
function runOnce(step: IStepConfig, sink: IApiPostCapture[], setup = PLAIN): RunResult {
  const responses = [succeed({})];
  const bus = makeStubMediator({ responses, captures: sink });
  const carry = { bcKey: 'syn-bc-1' };
  const scope: ITemplateScope = { carry, creds: {}, config: setup.config, keypair: undefined };
  return runStep({ step, bus, scope, companyId: HINT, ...setup.extras });
}

/**
 * Run a step once and return the headers it sent.
 * @param step - Step config.
 * @param setup - Config, jar and signing key for the call.
 * @returns The sent header map ({} when none was sent).
 */
async function sentHeaders(step: IStepConfig, setup = PLAIN): Promise<Record<string, string>> {
  const captures: IApiPostCapture[] = [];
  await runOnce(step, captures, setup);
  return captures[0].extraHeaders ?? {};
}

/**
 * The names in a header map that equal `name` ignoring case.
 * @param headers - Sent header map.
 * @param name - Header name to look for.
 * @returns Every matching name, as sent.
 */
function namesLike(headers: Record<string, string>, name: string): string[] {
  const lower = name.toLowerCase();
  return Object.keys(headers).filter((key): boolean => key.toLowerCase() === lower);
}

/**
 * A fresh ECDSA key for the signer cases.
 * @returns Signing keypair.
 */
function makeKeypair(): IGenericKeypair {
  const proc = generateKeypair('ECDSA-P256');
  if (!proc.success) throw new ScraperError('keypair generation failed');
  return proc.value;
}

describe('step header templates', () => {
  it('resolves a carry ref for the call', async (): Promise<void> => {
    const step = stepWith({ 'X-Bc-Key': { $ref: 'carry.bcKey' } });
    const headers = await sentHeaders(step);
    expect(headers).toEqual({ 'X-Site': 'static', 'X-Keep': 'kept', 'X-Bc-Key': 'syn-bc-1' });
  });

  it('sends a fresh uuid on every call', async (): Promise<void> => {
    const step = stepWith({ 'X-Request-Id': { $ref: 'uuid' } });
    const first = await sentHeaders(step);
    const second = await sentHeaders(step);
    const ids = [first['X-Request-Id'], second['X-Request-Id']];
    expect(ids).toEqual([expect.stringMatching(UUID_SHAPE), expect.stringMatching(UUID_SHAPE)]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('sends a non-string value as its JSON text', async (): Promise<void> => {
    const step = stepWith({ 'X-Version': { $literal: 7 }, 'X-Mobile': { $literal: true } });
    const headers = await sentHeaders(step);
    expect(headers).toMatchObject({ 'X-Version': '7', 'X-Mobile': 'true' });
  });

  it('replaces a static header whatever its case', async (): Promise<void> => {
    const step = stepWith({ 'x-site': { $literal: 'step' } });
    const headers = await sentHeaders(step);
    expect(headers).toEqual({ 'X-Keep': 'kept', 'x-site': 'step' });
  });

  it('fails the step before sending when a header ref is missing', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const step = stepWith({ 'X-Bc-Key': { $ref: 'carry.absent' } });
    const result = await runOnce(step, captures);
    expect(captures).toEqual([]);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'ref carry.absent missing from scope.carry',
    });
  });
});

describe('managed headers win over step headers', () => {
  it('sends the jar cookie alone over a step cookie of any case', async (): Promise<void> => {
    const cookieJar = createSimpleCookieJar();
    cookieJar.add(['sid=syn-jar']);
    const step = { ...stepWith({ cookie: { $literal: 'sid=syn-stale' } }), cookieJar: true };
    const headers = await sentHeaders(step, { config: CONFIG, extras: { cookieJar } });
    const cookieNames = namesLike(headers, 'Cookie');
    expect(cookieNames).toEqual(['Cookie']);
    expect(headers.Cookie).toBe('sid=syn-jar');
  });

  it('sends the signature alone over a step header of any case', async (): Promise<void> => {
    const signingKeypair = makeKeypair();
    const step = stepWith({ 'x-sig': { $literal: 'syn-stale' } });
    const headers = await sentHeaders(step, { config: SIGNED_CONFIG, extras: { signingKeypair } });
    const signatureNames = namesLike(headers, 'X-Sig');
    expect(signatureNames).toEqual(['X-Sig']);
    expect(headers['X-Sig']).toMatch(SIGNATURE_SHAPE);
  });
});
