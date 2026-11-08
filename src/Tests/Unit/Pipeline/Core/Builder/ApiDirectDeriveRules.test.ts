/**
 * A derivation `op` is `format` or `md5-hex`. A `format` op names at
 * least one rule; each pattern compiles with the `u` flag and uses the flat
 * grammar; `padStart` is an integer from 0 to 64. The rules cover flow-init
 * `derivedCarry` and every step's `deriveCarry`.
 */

import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  DerivedOp,
  IDerivedCarry,
  IFormatRule,
  IGetStep,
  RefToken,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://derive.example';
const NATIVE = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {}, nativeFetch: true };
const KIND_MSG = 'derive.op.kind: must be format, md5-hex, url-query, url-path-map or url-compose';
const QUERY_MSG = 'derive.op.url-query: needs one part and a valid key';
const RULES_MSG = 'derive.op.rules: needs at least one rule';
const COMPILE_MSG = 'derive.op.rules.pattern: must compile';
const FLAT_MSG = 'derive.op.rules.pattern: must be a flat regex';
const PAD_MSG = 'derive.op.rules.padStart: must be an integer from 0 to 64';
const ID_RULE: IFormatRule = { pattern: String.raw`^\d{1,9}$`, prefix: '00001', padStart: 9 };

/**
 * A `format` op over one rule patched with the given fields.
 * @param patch - Fields over the id rule.
 * @returns Format op.
 */
function formatWith(patch: Partial<IFormatRule>): DerivedOp {
  return { kind: 'format', rules: [{ ...ID_RULE, ...patch }] };
}

/**
 * The derivation that shapes `uid` with the op.
 * @param op - Derivation op.
 * @param parts - Source refs.
 * @returns Derivation.
 */
function deriving(op: DerivedOp, parts: readonly RefToken[] = ['creds.num']): IDerivedCarry {
  return { into: 'uid', parts, op };
}

/**
 * Rule input deriving at flow init.
 * @param op - Derivation op.
 * @param parts - Source refs.
 * @returns Rule input.
 */
function initRun(op: DerivedOp, parts?: readonly RefToken[]): IApiDirectRuleInput {
  const derivedCarry = [deriving(op, parts)];
  return { call: { flow: 'sms-otp', envelope: {}, steps: [], derivedCarry }, headless: NATIVE };
}

/**
 * Rule input deriving in a step.
 * @param op - Derivation op.
 * @param parts - Source refs.
 * @returns Rule input.
 */
function stepRun(op: DerivedOp, parts?: readonly RefToken[]): IApiDirectRuleInput {
  const step: IGetStep = {
    name: 'encryptionKey',
    urlTag: 'auth.bind',
    method: 'GET',
    extractsToCarry: {},
    deriveCarry: [deriving(op, parts)],
  };
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless: NATIVE };
}

const UNKNOWN_KIND = { kind: 'sha1' } as unknown as DerivedOp;

const BROKEN: readonly [string, DerivedOp, string][] = [
  ['an unknown kind', UNKNOWN_KIND, KIND_MSG],
  ['a format op with no rule', { kind: 'format', rules: [] }, RULES_MSG],
  ['a pattern that does not compile', formatWith({ pattern: '^(\\d$' }), COMPILE_MSG],
  ['a pattern only the u flag refuses', formatWith({ pattern: String.raw`^\-$` }), COMPILE_MSG],
  ['a pattern repeating a group', formatWith({ pattern: String.raw`^(\d+)+$` }), FLAT_MSG],
  ['adjacent star repeats', formatWith({ pattern: '^a*a*b$' }), FLAT_MSG],
  ['adjacent plus repeats', formatWith({ pattern: '^a+a+$' }), FLAT_MSG],
  ['a negative padStart', formatWith({ padStart: -1 }), PAD_MSG],
  ['a fractional padStart', formatWith({ padStart: 1.5 }), PAD_MSG],
  ['a padStart over 64', formatWith({ padStart: 65 }), PAD_MSG],
];

const VALID: readonly [string, DerivedOp][] = [
  ['md5-hex', { kind: 'md5-hex' }],
  ['url-query', { kind: 'url-query', key: 'tracking' }],
  ['the id rule', formatWith({})],
  ['an unanchored pattern', formatWith({ pattern: String.raw`\d{1,9}` })],
  ['a start-only anchor', formatWith({ pattern: String.raw`^\d{1,9}` })],
  ['an end-only anchor', formatWith({ pattern: String.raw`\d{1,9}$` })],
  ['a literal trailing dollar', formatWith({ pattern: String.raw`price\$` })],
  ['a rule with no padStart', formatWith({ padStart: undefined })],
  ['padStart 0', formatWith({ padStart: 0 })],
  ['padStart 64', formatWith({ padStart: 64 })],
  ['a repeated escaped paren', formatWith({ pattern: String.raw`^\)+$` })],
];

describe('validateApiDirectConfig — derivation ops', () => {
  it.each(BROKEN)('%s at flow init fails the build', (_label, op, errorMessage) => {
    const input = initRun(op);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage });
  });

  it.each(BROKEN)('%s in a step fails the build', (_label, op, errorMessage) => {
    const input = stepRun(op);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage });
  });

  it.each(VALID)('%s builds at flow init and in a step', (_label, op) => {
    const inputs = [initRun(op), stepRun(op)];
    const built = inputs.map(input => validateApiDirectConfig(input).success);
    expect(built).toEqual([true, true]);
  });

  it.each([
    ['no source part', { kind: 'url-query', key: 'tracking' }, []],
    ['multiple source parts', { kind: 'url-query', key: 'tracking' }, ['creds.num', 'creds.num']],
    ['an empty key', { kind: 'url-query', key: '' }, ['creds.num']],
    ['a blank key', { kind: 'url-query', key: ' ' }, ['creds.num']],
    ['a control in the key', { kind: 'url-query', key: 'track\u0000ing' }, ['creds.num']],
    ['a C1 control in the key', { kind: 'url-query', key: 'track\u0085ing' }, ['creds.num']],
    ['an oversized key', { kind: 'url-query', key: 'k'.repeat(8193) }, ['creds.num']],
  ] as const)('rejects %s at flow init and in a step', (_label, op, parts) => {
    const inputs = [initRun(op, parts), stepRun(op, parts)];
    for (const input of inputs) {
      const result = validateApiDirectConfig(input);
      expect(result).toMatchObject({
        success: false,
        errorMessage: QUERY_MSG,
      });
    }
  });

  it.each([false, 'true', null])('rejects a malformed query blank policy', rejectBlank => {
    const op: DerivedOp = { kind: 'url-query', key: 'tracking' };
    Reflect.set(op, 'rejectBlank', rejectBlank);
    const input = stepRun(op);
    const result = validateApiDirectConfig(input);
    const errorMessage = 'derive.op.url-query.rejectBlank: must be true when set';
    expect(result).toMatchObject({ success: false, errorMessage });
  });
});
