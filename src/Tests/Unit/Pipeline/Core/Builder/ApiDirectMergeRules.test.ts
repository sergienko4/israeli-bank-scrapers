/**
 * A `$merge` node may only be a form body's whole shape (`form` or
 * `form-latin1` or `form-utf8`), with a `carry.` base and a flat `set`. A malformed root
 * fails as a nested form; a `$merge` anywhere else — a JSON or text body, a
 * form field, a header, a query — fails the build. A `$merge` key inside a
 * `$literal` payload is data, not a node.
 */

import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IPostStep,
  JsonValueTemplate,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://form.example';
const NATIVE = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {}, nativeFetch: true };
const FLAT_MSG = 'steps.body: a form body must be a flat record';
const STRAY_MSG = 'steps: $merge belongs only at the root of a form body';
const FORM_ENCODINGS = ['form', 'form-latin1', 'form-utf8'] as const;

const SET: JsonValueTemplate = {
  passwordEnc: { $ref: 'carry.token' },
  user: { $join: { parts: ['creds.username'] } },
  lang: { $literal: 'he' },
};
const MERGE = { $merge: { base: 'carry.loginForm', set: SET } } as JsonValueTemplate;
const FLAT: JsonValueTemplate = { user: { $ref: 'creds.username' } };

/**
 * A `$merge` node over the given payload, typed loosely for broken cases.
 * @param payload - The `$merge` payload.
 * @returns Template node.
 */
function mergeOf(payload: unknown): JsonValueTemplate {
  return { $merge: payload } as unknown as JsonValueTemplate;
}

/**
 * A step sending the given body shape.
 * @param shape - Body shape.
 * @param encoding - Body encoding, form when absent.
 * @returns POST step.
 */
function stepWith(shape: JsonValueTemplate, encoding: IPostStep['encoding'] = 'form'): IPostStep {
  return { name: 'logon', urlTag: 'auth.logon', encoding, body: { shape }, extractsToCarry: {} };
}

/**
 * The build verdict on one step running on native fetch.
 * @param step - The login step.
 * @returns Validation result.
 */
function verdictOf(step: IPostStep): ReturnType<typeof validateApiDirectConfig> {
  const input: IApiDirectRuleInput = {
    call: { flow: 'sms-otp', envelope: {}, steps: [step] },
    transport: NATIVE,
  };
  return validateApiDirectConfig(input);
}

const BROKEN_ROOTS: readonly (readonly [string, JsonValueTemplate])[] = [
  ['a creds base', mergeOf({ base: 'creds.username', set: SET })],
  ['a blank carry base', mergeOf({ base: 'carry.', set: SET })],
  ['a non-string base', mergeOf({ base: 5, set: SET })],
  ['no set', mergeOf({ base: 'carry.loginForm' })],
  ['a nested set', mergeOf({ base: 'carry.f', set: { a: { b: { $literal: 'x' } } } })],
  ['an array set', mergeOf({ base: 'carry.f', set: [{ $literal: 'x' }] })],
  ['a merge in the set', mergeOf({ base: 'carry.f', set: { a: MERGE } })],
  ['a string payload', mergeOf('carry.loginForm')],
  ['a sibling key', { ...(MERGE as object), extra: { $literal: 'x' } }],
  ['a merge as a field', { a: MERGE }],
];

const BROKEN_ROOTS_PER_ENCODING = FORM_ENCODINGS.flatMap(encoding =>
  BROKEN_ROOTS.map(([label, shape]) => [encoding, label, shape] as const),
);

const STRAY: readonly (readonly [string, IPostStep])[] = [
  ['a JSON body root', stepWith(MERGE, 'json')],
  ['a JSON body field', stepWith({ a: [MERGE] }, 'json')],
  ['a text body', stepWith({ text: MERGE }, 'text')],
  ['a header', { ...stepWith(FLAT), headers: { 'X-Form': MERGE } }],
  ['a query', { ...stepWith(FLAT), queryTemplate: { form: MERGE } }],
];

describe('validateApiDirectConfig — $merge bodies', () => {
  it.each(FORM_ENCODINGS)('a %s body that is one $merge passes', encoding => {
    const step = stepWith(MERGE, encoding);
    const result = verdictOf(step);
    expect(result).toEqual({ success: true, value: true });
  });

  it.each(BROKEN_ROOTS_PER_ENCODING)(
    'a %s $merge with %s fails as nested',
    (encoding, _l, shape) => {
      const step = stepWith(shape, encoding);
      const result = verdictOf(step);
      expect(result).toMatchObject({ success: false, errorMessage: FLAT_MSG });
    },
  );

  it.each(STRAY)('a $merge in %s fails the build', (_label, step) => {
    const result = verdictOf(step);
    expect(result).toMatchObject({ success: false, errorMessage: STRAY_MSG });
  });

  it('a $merge key inside a $literal payload is data', () => {
    const literal = { $literal: { $merge: { base: 'carry.f', set: {} } } };
    const step = stepWith({ a: literal }, 'json');
    const result = verdictOf(step);
    expect(result).toEqual({ success: true, value: true });
  });
});
