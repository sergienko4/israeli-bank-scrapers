/**
 * N39 / N52 exchange mode — the key-exchange step sends its hydrated body as
 * it is, derives the session from the bank's `key_exchange` header and the
 * carried client scalar, opens the answer under it, and carries the key and
 * the session id for the sealed steps after it. A bad scalar fails before the
 * request; a plaintext or foreign answer can only fail. Failures name the
 * step, never a key, IV or plaintext.
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
import type {
  JsonUnknownRecord,
  JsonValue,
} from '../../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  CLIENT_PRIVATE_TEXT,
  clientPublic,
  exchangeAnswer,
  keyExchangeHeader,
  peerKey,
  sealUnder,
} from '../../../../../Helpers/EnvelopeExchangeOracle.js';
import { ENVELOPE_KEY, ENVELOPE_SESSION_ID } from '../../../../../Helpers/EnvelopeOracle.js';
import { fakeFetch, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const GREETING = { r: 'Hello Encrypted World' };
const OFF_CURVE = Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64');
const FOREIGN_SEAL = sealUnder(ENVELOPE_KEY, GREETING);
const SHORT_SCALAR = Buffer.alloc(31, 0x22).toString('base64');
const ZERO_SCALAR = Buffer.alloc(32).toString('base64');

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const EXCHANGE_STEP: IPostStep = {
  name: 'encryptionKey',
  urlTag: 'auth.encryptionKey',
  codec: {
    kind: 'ecdh-aes-cbc',
    mode: 'exchange',
    privateRef: 'carry.ecdhPrivate',
    keyInto: 'envelopeKey',
    sessionInto: 'envelopeSession',
  },
  body: {
    shape: {
      headers: [
        { type: { $literal: 'flow_id' }, flow_id: { $ref: 'carry.flowId' } },
        {
          type: { $literal: 'key_exchange' },
          scheme: { $literal: 2 },
          y: { $ref: 'carry.ecdhPublic' },
        },
      ],
      data: { r: { $literal: 'Hello Encrypted World' } },
    },
  },
  extractsToCarry: { greeting: '/data/r' },
};

beforeAll((): void => {
  registerWkUrl('auth.encryptionKey', HINT, `${ORIGIN}/api/v2/auth/key_exchange`);
});

/**
 * Template scope holding the client key pair and a flow id.
 * @param extra - Carry slots over the synthetic ones.
 * @returns Template scope.
 */
function scopeWith(extra: Readonly<Record<string, string>> = {}): ITemplateScope {
  const ecdhPublic = clientPublic();
  const base = { ecdhPrivate: CLIENT_PRIVATE_TEXT, ecdhPublic, flowId: 'F00D' };
  const carry = { ...base, ...extra };
  return { carry, creds: {}, config: CONFIG, keypair: undefined };
}

/**
 * Point fetch at a fake answering every call with `answer` as JSON.
 * @param answer - Answer body.
 * @returns The fake, for request assertions.
 */
function serve(answer: JsonUnknownRecord): IFetchFake {
  const fake = fakeFetch((): Response => Response.json(answer));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * Fire the exchange step through the real mediator and native transport.
 * @param scope - Step scope.
 * @returns The step result.
 */
async function fireExchange(scope: ITemplateScope): Promise<Procedure<ITemplateScope>> {
  const bus = makeNativeMediator(HINT, ORIGIN);
  return runStep({ step: EXCHANGE_STEP, bus, scope, companyId: HINT });
}

/**
 * The valid answer with one field of its envelope replaced.
 * @param field - Envelope field.
 * @param value - Replacement.
 * @returns The answer.
 */
function answerWithField(field: string, value: JsonValue): JsonUnknownRecord {
  const answer = exchangeAnswer(GREETING);
  return { ...answer, [field]: value };
}

describe('N39 key-exchange step', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('sends the hydrated body as it is', async () => {
    const answer = exchangeAnswer(GREETING);
    const fake = serve(answer);
    const scope = scopeWith();
    const result = await fireExchange(scope);
    expect(result.success).toBe(true);
    const sent = JSON.parse(fake.calls[0].init.body as string) as JsonValue;
    const y = clientPublic();
    expect(sent).toEqual({
      headers: [
        { type: 'flow_id', flow_id: 'F00D' },
        { type: 'key_exchange', scheme: 2, y },
      ],
      data: GREETING,
    });
  });

  it('carries the key the bank derives and its session id, and extracts the opened data', async () => {
    const answer = exchangeAnswer(GREETING);
    serve(answer);
    const scope = scopeWith();
    const result = await fireExchange(scope);
    if (!result.success) throw new TypeError(result.errorMessage);
    const keyText = peerKey().toString('base64');
    expect(result.value.carry.envelopeKey).toBe(keyText);
    expect(result.value.carry.envelopeSession).toBe(ENVELOPE_SESSION_ID);
    expect(result.value.carry.greeting).toBe(GREETING.r);
  });

  it.each([
    ['a plaintext answer', { headers: [keyExchangeHeader()], data: GREETING }, 'envelope invalid'],
    ['a plaintext error_code', { error_code: 10, error_message: 'syn-text' }, 'bank error'],
    ['no key_exchange header', exchangeAnswer(GREETING, []), 'envelope invalid'],
    [
      'a point off the curve',
      exchangeAnswer(GREETING, [keyExchangeHeader({ y: OFF_CURVE })]),
      'envelope invalid',
    ],
    [
      'a foreign session',
      exchangeAnswer(GREETING, [keyExchangeHeader()], { crypto_session_id: 'other' }),
      'envelope invalid',
    ],
    [
      'two encryption headers',
      exchangeAnswer(GREETING, [keyExchangeHeader(), { type: 'encryption' }]),
      'envelope invalid',
    ],
    ['sealed headers in the answer', answerWithField('enc_headers', ['AA==']), 'envelope invalid'],
    ['data sealed under another key', answerWithField('data', FOREIGN_SEAL), 'envelope invalid'],
    ['an opened error_code', exchangeAnswer({ error_code: 4001 }), 'bank error'],
  ])(
    'fails %s, naming the step only',
    async (_label: string, answer: JsonUnknownRecord, reason: string) => {
      serve(answer);
      const scope = scopeWith();
      const result = await fireExchange(scope);
      expect(result).toMatchObject({
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: `encryptionKey ${reason}`,
      });
    },
  );

  it.each([
    ['a missing scalar', { ecdhPrivate: '' }],
    ['a 31-byte scalar', { ecdhPrivate: SHORT_SCALAR }],
    ['the zero scalar', { ecdhPrivate: ZERO_SCALAR }],
  ])('refuses %s before sending', async (_label: string, extra: Record<string, string>) => {
    const answer = exchangeAnswer(GREETING);
    const fake = serve(answer);
    const scope = scopeWith(extra);
    const result = await fireExchange(scope);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'encryptionKey envelope key invalid',
    });
    expect(fake.calls).toHaveLength(0);
  });
});
