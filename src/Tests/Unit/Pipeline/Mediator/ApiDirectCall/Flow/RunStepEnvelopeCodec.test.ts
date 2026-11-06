/**
 * A step with a `sealed` envelope codec sends its hydrated
 * `{ headers, data }` body sealed under the carried session key, and opens its
 * answer before any guard, outcome or extract reads it: extracts see the
 * original headers and the opened data. A plaintext answer can only fail — a
 * bank error when it carries a non-zero numeric `error_code`, an invalid
 * envelope otherwise. A bank error takes the step's `bankErrorType`, an
 * invalid envelope stays Generic. Failures name the step, never a key, IV or
 * plaintext.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IPostStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  aesOpen,
  ENVELOPE_KEY_TEXT,
  ENVELOPE_SESSION_ID,
  sealedAnswer,
} from '../../../../../Helpers/EnvelopeOracle.js';
import { fakeFetch, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const SESSION_HEADER = { type: 'session_id', session_id: 'syn-sid' };

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const SEALED_STEP: IPostStep = {
  name: 'login',
  urlTag: 'auth.login',
  codec: {
    kind: 'ecdh-aes-cbc',
    mode: 'sealed',
    keyRef: 'carry.envelopeKey',
    sessionRef: 'carry.envelopeSession',
  },
  body: {
    shape: {
      headers: [{ type: { $literal: 'flow_id' }, flow_id: { $ref: 'carry.flowId' } }],
      data: { policy_request_id: { $literal: 'Login' }, params: { bankId: { $literal: '031' } } },
    },
  },
  failIfPresent: ['/data/assertion_error_code'],
  extractsToCarry: { state: '/data/state', sid: '/headers/1/session_id' },
};

/** The sealed step, typing its bank errors as a wrong OTP. */
const TYPED_STEP: IPostStep = { ...SEALED_STEP, bankErrorType: ScraperErrorTypes.InvalidOtp };

const PLAINTEXT_ANSWER = { headers: [SESSION_HEADER], data: { state: 'pending' } };
const PLAINTEXT_ERROR = { error_code: 10, error_message: 'syn-text' };

/** The JSON request a sealed step sent. */
interface ISentEnvelope {
  readonly headers: readonly { readonly type: string; readonly iv: string }[];
  readonly enc_headers: readonly string[];
  readonly data: string;
}

beforeAll((): void => {
  registerWkUrl('auth.login', HINT, `${ORIGIN}/api/v2/auth/login`);
});

/**
 * Template scope holding the session key, the session id and a flow id.
 * @param extra - Carry slots over the synthetic ones.
 * @returns Template scope.
 */
function scopeWith(extra: Readonly<Record<string, string>> = {}): ITemplateScope {
  const base = {
    envelopeKey: ENVELOPE_KEY_TEXT,
    envelopeSession: ENVELOPE_SESSION_ID,
    flowId: 'F00D',
  };
  const carry = { ...base, ...extra };
  return { carry, creds: {}, config: CONFIG, keypair: undefined };
}

/**
 * Point fetch at a fake answering every call with `answer` as JSON.
 * @param answer - Answer body.
 * @returns The fake, for request assertions.
 */
function serve(answer: object): IFetchFake {
  const fake = fakeFetch((): Response => Response.json(answer));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * Fire a sealed step through the real mediator and native transport.
 * @param scope - Step scope.
 * @param step - The sealed step; the untyped one by default.
 * @returns The step result.
 */
async function fireSealed(
  scope: ITemplateScope,
  step: IPostStep = SEALED_STEP,
): Promise<Procedure<ITemplateScope>> {
  const bus = makeNativeMediator(HINT, ORIGIN);
  return runStep({ step, bus, scope, companyId: HINT });
}

/**
 * The envelope the first request sent.
 * @param fake - The fetch fake.
 * @returns The parsed request body.
 */
function sentEnvelope(fake: IFetchFake): ISentEnvelope {
  const body = fake.calls[0].init.body as string;
  return JSON.parse(body) as ISentEnvelope;
}

describe('sealed step', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('sends the hydrated headers and data sealed under the session key', async () => {
    const answer = sealedAnswer({ state: 'pending' }, [SESSION_HEADER]);
    const fake = serve(answer);
    const scope = scopeWith();
    const result = await fireSealed(scope);
    expect(result.success).toBe(true);
    const sent = sentEnvelope(fake);
    const iv = sent.headers[0].iv;
    expect(sent.headers).toEqual([
      { type: 'encryption', iv, crypto_session_id: ENVELOPE_SESSION_ID },
    ]);
    const headerText = aesOpen(sent.enc_headers[0], iv);
    const header = JSON.parse(headerText) as JsonValue;
    expect(header).toEqual({ type: 'flow_id', flow_id: 'F00D' });
    const dataText = aesOpen(sent.data, iv);
    const data = JSON.parse(dataText) as JsonValue;
    expect(data).toEqual({ policy_request_id: 'Login', params: { bankId: '031' } });
  });

  it('extracts from the original headers and the opened data', async () => {
    const answer = sealedAnswer({ state: 'pending', error_code: 0 }, [SESSION_HEADER]);
    serve(answer);
    const scope = scopeWith();
    const result = await fireSealed(scope);
    if (!result.success) throw new TypeError(result.errorMessage);
    expect(result.value.carry.state).toBe('pending');
    expect(result.value.carry.sid).toBe('syn-sid');
  });

  it.each([
    ['a plaintext answer', PLAINTEXT_ANSWER, 'envelope invalid'],
    ['a plaintext error_code', PLAINTEXT_ERROR, 'bank error'],
    ['an opened error_code', sealedAnswer({ error_code: 4001, state: 'pending' }), 'bank error'],
    ['an opened guard pointer', sealedAnswer({ assertion_error_code: 7 }), 'bank error'],
  ])('fails %s, naming the step only', async (_label: string, answer: object, reason: string) => {
    serve(answer);
    const scope = scopeWith();
    const result = await fireSealed(scope);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: `login ${reason}`,
    });
  });

  it.each([
    ['a plaintext error_code', PLAINTEXT_ERROR],
    ['an opened error_code', sealedAnswer({ error_code: 4001, state: 'pending' })],
    ['an opened guard pointer', sealedAnswer({ assertion_error_code: 7 })],
  ])("fails %s with the step's bankErrorType", async (_label: string, answer: object) => {
    serve(answer);
    const scope = scopeWith();
    const result = await fireSealed(scope, TYPED_STEP);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.InvalidOtp,
      errorMessage: 'login bank error',
    });
  });

  it('keeps an invalid envelope Generic on a typed step', async () => {
    serve(PLAINTEXT_ANSWER);
    const scope = scopeWith();
    const result = await fireSealed(scope, TYPED_STEP);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'login envelope invalid',
    });
  });

  it.each([
    ['a missing key', { envelopeKey: '' }],
    ['a 16-byte key', { envelopeKey: Buffer.alloc(16, 1).toString('base64') }],
    ['an empty session id', { envelopeSession: '' }],
  ])('refuses %s before sending', async (_label: string, extra: Record<string, string>) => {
    const answer = sealedAnswer({ state: 'pending' });
    const fake = serve(answer);
    const scope = scopeWith(extra);
    const result = await fireSealed(scope);
    expect(result).toMatchObject({ success: false, errorMessage: 'login envelope key invalid' });
    expect(fake.calls).toHaveLength(0);
  });
});
