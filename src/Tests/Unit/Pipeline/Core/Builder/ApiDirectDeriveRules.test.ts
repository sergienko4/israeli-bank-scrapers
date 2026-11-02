/**
 * N45 — a derivation `op` is `format` or `md5-hex`. A `format` op names at
 * least one rule; each pattern compiles with the `u` flag and repeats no
 * group; `padStart` is an integer from 0 to 64. The rules cover flow-init
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
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://derive.example';
const NATIVE = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {}, nativeFetch: true };
const KIND_MSG = 'derive.op.kind: must be format or md5-hex';
const RULES_MSG = 'derive.op.rules: needs at least one rule';
const COMPILE_MSG = 'derive.op.rules.pattern: must compile';
const REPEAT_MSG = 'derive.op.rules.pattern: must not repeat a group';
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
 * @returns Derivation.
 */
function deriving(op: DerivedOp): IDerivedCarry {
  return { into: 'uid', parts: ['creds.num'], op };
}

/**
 * Rule input deriving at flow init.
 * @param op - Derivation op.
 * @returns Rule input.
 */
function initRun(op: DerivedOp): IApiDirectRuleInput {
  const derivedCarry = [deriving(op)];
  return { call: { flow: 'sms-otp', envelope: {}, steps: [], derivedCarry }, headless: NATIVE };
}

/**
 * Rule input deriving in a step.
 * @param op - Derivation op.
 * @returns Rule input.
 */
function stepRun(op: DerivedOp): IApiDirectRuleInput {
  const step: IGetStep = {
    name: 'encryptionKey',
    urlTag: 'auth.bind',
    method: 'GET',
    extractsToCarry: {},
    deriveCarry: [deriving(op)],
  };
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless: NATIVE };
}

const UNKNOWN_KIND = { kind: 'sha1' } as unknown as DerivedOp;

const BROKEN: readonly [string, DerivedOp, string][] = [
  ['an unknown kind', UNKNOWN_KIND, KIND_MSG],
  ['a format op with no rule', { kind: 'format', rules: [] }, RULES_MSG],
  ['a pattern that does not compile', formatWith({ pattern: '^(\\d$' }), COMPILE_MSG],
  ['a pattern only the u flag refuses', formatWith({ pattern: String.raw`^\-$` }), COMPILE_MSG],
  ['a pattern repeating a group', formatWith({ pattern: String.raw`^(\d+)+$` }), REPEAT_MSG],
  ['a negative padStart', formatWith({ padStart: -1 }), PAD_MSG],
  ['a fractional padStart', formatWith({ padStart: 1.5 }), PAD_MSG],
  ['a padStart over 64', formatWith({ padStart: 65 }), PAD_MSG],
];

const VALID: readonly [string, DerivedOp][] = [
  ['md5-hex', { kind: 'md5-hex' }],
  ['the id rule', formatWith({})],
  ['a rule with no padStart', formatWith({ padStart: undefined })],
  ['padStart 0', formatWith({ padStart: 0 })],
  ['padStart 64', formatWith({ padStart: 64 })],
  ['a repeated escaped paren', formatWith({ pattern: String.raw`^\)+$` })],
];

describe('validateApiDirectConfig — N45 derivation ops', () => {
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
});
