/**
 * A codec step sends a JSON body and reads a JSON answer; an `exchange`
 * codec writes its key and session id to two distinct, non-blank slots; no
 * codec slot (client scalar, session key or session id) is a `sessionCarry`
 * slot.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  EnvelopeCodec,
  IEnvelopeExchange,
  IEnvelopeSealed,
  IPostStep,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://codec.example';
const NATIVE = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {}, nativeFetch: true };
const JSON_MSG = 'steps.codec: needs a json body and a json response';
const SLOTS_MSG = 'steps.codec: exchange needs distinct keyInto and sessionInto';
const SESSION_MSG = 'steps.codec: codec slots must not be sessionCarry slots';
const ECHO_MSG = 'steps.codec: exchange echoRef needs a nonblank carry slot';

const EXCHANGE: IEnvelopeExchange = {
  kind: 'ecdh-aes-cbc',
  mode: 'exchange',
  privateRef: 'carry.ecdhPrivate',
  keyInto: 'envelopeKey',
  sessionInto: 'envelopeSession',
};

const SEALED: IEnvelopeSealed = {
  kind: 'ecdh-aes-cbc',
  mode: 'sealed',
  keyRef: 'carry.envelopeKey',
  sessionRef: 'carry.envelopeSession',
};

/** A step change and the session slots a refused or accepted run keeps. */
interface IRunCase {
  readonly label: string;
  readonly change: Partial<IPostStep>;
  readonly sessionCarry?: readonly string[];
}

/** One refused run and its message. */
interface IRefusalCase extends IRunCase {
  readonly expected: string;
}

/**
 * A POST step enveloped by a codec, with a change over it.
 * @param codec - The step's codec.
 * @param change - Fields over the step.
 * @returns The step.
 */
function stepOf(codec: EnvelopeCodec, change: Partial<IPostStep>): IPostStep {
  return {
    name: 'encryptionKey',
    urlTag: 'auth.encryptionKey',
    body: { shape: { headers: [], data: {} } },
    extractsToCarry: {},
    codec,
    ...change,
  };
}

/**
 * Rule input running an exchange step and a sealed step after it. The sealed
 * step extracts every kept slot, so only the codec rules can refuse one.
 * @param run - The change to the exchange step and the session slots.
 * @returns Rule input.
 */
function runOf(run: IRunCase): IApiDirectRuleInput {
  const exchange = stepOf(EXCHANGE, run.change);
  const sessionCarry = run.sessionCarry ?? ['authorization'];
  const pointers = sessionCarry.map(slot => [slot, `/data/${slot}`]);
  const extractsToCarry = Object.fromEntries(pointers) as IPostStep['extractsToCarry'];
  const sealed = stepOf(SEALED, { name: 'login', urlTag: 'auth.login', extractsToCarry });
  const steps = [exchange, sealed];
  return { call: { flow: 'sms-otp', envelope: {}, steps, sessionCarry }, transport: NATIVE };
}

/**
 * An exchange codec with a change over it.
 * @param change - Fields over the exchange codec.
 * @returns The codec.
 */
function exchangeWith(change: Partial<IEnvelopeExchange>): IEnvelopeExchange {
  return { ...EXCHANGE, ...change };
}

const FLAT_BODY: IPostStep['body'] = { shape: { r: { $literal: 'x' } } };
const TEXT_BODY: IPostStep['body'] = { shape: { text: { $literal: 'x' } } };
const BLANK_KEY = exchangeWith({ keyInto: ' ' });
const BLANK_SESSION = exchangeWith({ sessionInto: '' });
const SHARED_SLOT = exchangeWith({ sessionInto: 'envelopeKey' });
const ECHO = { ...EXCHANGE, echoRef: 'carry.ecdhPublic' } as const;
const EMPTY_ECHO = { ...EXCHANGE, echoRef: 'carry.' } as const;
const BLANK_ECHO = { ...EXCHANGE, echoRef: 'carry.  ' } as const;
const FOREIGN_ECHO = { ...EXCHANGE, echoRef: 'creds.publicKey' as `carry.${string}` };

const REFUSALS: readonly IRefusalCase[] = [
  { label: 'a form body', change: { encoding: 'form', body: FLAT_BODY }, expected: JSON_MSG },
  { label: 'a text body', change: { encoding: 'text', body: TEXT_BODY }, expected: JSON_MSG },
  { label: 'a text answer', change: { response: 'text' }, expected: JSON_MSG },
  { label: 'a document answer', change: { response: 'document' }, expected: JSON_MSG },
  { label: 'a blank keyInto', change: { codec: BLANK_KEY }, expected: SLOTS_MSG },
  { label: 'a blank sessionInto', change: { codec: BLANK_SESSION }, expected: SLOTS_MSG },
  { label: 'one slot for key and id', change: { codec: SHARED_SLOT }, expected: SLOTS_MSG },
  { label: 'an empty echo ref', change: { codec: EMPTY_ECHO }, expected: ECHO_MSG },
  { label: 'a blank echo ref', change: { codec: BLANK_ECHO }, expected: ECHO_MSG },
  { label: 'a non-carry echo ref', change: { codec: FOREIGN_ECHO }, expected: ECHO_MSG },
  { label: 'a kept scalar', change: {}, sessionCarry: ['ecdhPrivate'], expected: SESSION_MSG },
  { label: 'a kept session key', change: {}, sessionCarry: ['envelopeKey'], expected: SESSION_MSG },
  {
    label: 'a kept session id',
    change: {},
    sessionCarry: ['envelopeSession'],
    expected: SESSION_MSG,
  },
];

const ACCEPTED: readonly IRunCase[] = [
  { label: 'the bank flow', change: {} },
  { label: 'a carried echo reference', change: { codec: ECHO } },
  { label: 'explicit json', change: { encoding: 'json', response: 'json' } },
  { label: 'a typed bank error', change: { bankErrorType: ScraperErrorTypes.InvalidPassword } },
];

describe('validateApiDirectConfig — envelope codec', () => {
  it.each(REFUSALS)('refuses $label', run => {
    const input = runOf(run);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: run.expected,
    });
  });

  it('refuses a kept sealed-mode key', () => {
    const input = runOf({ label: 'sealed key', change: {}, sessionCarry: ['envelopeKey'] });
    const steps = input.call.steps.slice(1);
    const sealedOnly = { ...input, call: { ...input.call, steps } };
    const result = validateApiDirectConfig(sealedOnly);
    expect(result).toMatchObject({ success: false, errorMessage: SESSION_MSG });
  });

  it.each(ACCEPTED)('builds $label', run => {
    const input = runOf(run);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
