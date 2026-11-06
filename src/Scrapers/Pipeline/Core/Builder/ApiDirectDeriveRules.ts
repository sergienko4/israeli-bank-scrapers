/**
 * Derivation op rules (N45) over flow-init `derivedCarry` and every login
 * and resume step's `deriveCarry`. An op kind is `format` or `md5-hex`. A
 * `format` op names at least one rule; each rule pattern compiles alone
 * with the `u` flag and uses the linear-time FlatPattern grammar (explicit
 * anchors are optional because the evaluator adds them); `padStart`, when
 * set, is an integer from 0 to 64.
 */

import type { DerivedOp, IFormatRule } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { anchoredPattern } from '../../Mediator/ApiDirectCall/Flow/FlowInitCarry.ops.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';
import { isFlatPattern } from './FlatPattern.js';

/** Widest `padStart` a format rule may ask for. */
const MAX_PAD_START = 64;

/** Op kinds the evaluator runs. */
const KNOWN_OP_KINDS: ReadonlySet<string> = new Set<DerivedOp['kind']>(['format', 'md5-hex']);

/**
 * Every derivation op of the call, flow init first.
 * @param input - Rule input.
 * @returns The ops, in config order.
 */
function opsOf(input: IApiDirectRuleInput): readonly DerivedOp[] {
  const steps = allSteps(input.call);
  const stepDerived = steps.flatMap(step => step.deriveCarry ?? []);
  const derived = [...(input.call.derivedCarry ?? []), ...stepDerived];
  return derived.flatMap(entry => (entry.op === undefined ? [] : [entry.op]));
}

/**
 * A rule check over every derivation op.
 * @param isBad - Op check.
 * @returns True when any op fails it.
 */
function anyOp(isBad: (op: DerivedOp) => boolean): IApiDirectRule['isBroken'] {
  return (input: IApiDirectRuleInput): boolean => opsOf(input).some(isBad);
}

/**
 * A rule check over every rule of every format op.
 * @param isBad - Format rule check.
 * @returns True when any format rule fails it.
 */
function anyFormatRule(isBad: (rule: IFormatRule) => boolean): IApiDirectRule['isBroken'] {
  return anyOp((op): boolean => op.kind === 'format' && op.rules.some(isBad));
}

/**
 * Whether an op names a kind the evaluator lacks.
 * @param op - Derivation op.
 * @returns True for an unknown kind.
 */
function isUnknownKind(op: DerivedOp): boolean {
  return !KNOWN_OP_KINDS.has(op.kind);
}

/**
 * Whether a format op names no rule.
 * @param op - Derivation op.
 * @returns True for a format op with no rule.
 */
function hasNoRule(op: DerivedOp): boolean {
  return op.kind === 'format' && op.rules.length === 0;
}

/**
 * Whether a format rule's pattern does not compile.
 * @param rule - Format rule.
 * @returns True for a broken pattern.
 */
function isUncompilable(rule: IFormatRule): boolean {
  return anchoredPattern(rule.pattern) === false;
}

/**
 * Whether a format pattern falls outside the linear-time grammar.
 * @param rule - Format rule.
 * @returns True when no whole-pattern anchoring is flat.
 */
function isNonFlat(rule: IFormatRule): boolean {
  const { pattern } = rule;
  const anchored = [pattern, `^${pattern}`, `${pattern}$`, `^${pattern}$`];
  return !anchored.some(isFlatPattern);
}

/**
 * Whether a format rule's `padStart` is out of range.
 * @param rule - Format rule.
 * @returns True for a `padStart` that is not an integer from 0 to 64.
 */
function isBadPadStart(rule: IFormatRule): boolean {
  const width = rule.padStart;
  if (width === undefined) return false;
  return !Number.isInteger(width) || width < 0 || width > MAX_PAD_START;
}

/** Derivation op rules, checked after the carry-generator rules. */
const API_DIRECT_DERIVE_RULES: readonly IApiDirectRule[] = [
  { message: 'derive.op.kind: must be format or md5-hex', isBroken: anyOp(isUnknownKind) },
  { message: 'derive.op.rules: needs at least one rule', isBroken: anyOp(hasNoRule) },
  { message: 'derive.op.rules.pattern: must compile', isBroken: anyFormatRule(isUncompilable) },
  {
    message: 'derive.op.rules.pattern: must be a flat regex',
    isBroken: anyFormatRule(isNonFlat),
  },
  {
    message: 'derive.op.rules.padStart: must be an integer from 0 to 64',
    isBroken: anyFormatRule(isBadPadStart),
  },
];

export default API_DIRECT_DERIVE_RULES;
export { API_DIRECT_DERIVE_RULES };
