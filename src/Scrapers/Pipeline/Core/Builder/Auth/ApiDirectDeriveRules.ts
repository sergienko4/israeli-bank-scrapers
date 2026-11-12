/**
 * Derivation op rules over flow-init `derivedCarry` and every login
 * and resume step's `deriveCarry`. An op kind is `format`, `md5-hex` or
 * `url-query`. A query op needs one source part and a safe key. A
 * `format` op names at least one rule; each rule pattern compiles alone
 * with the `u` flag and uses the linear-time FlatPattern grammar (explicit
 * anchors are optional because the evaluator adds them); `padStart`, when
 * set, is an integer from 0 to 64.
 */

import type {
  DerivedOp,
  IDerivedCarry,
  IFormatRule,
} from '../../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  anchoredPattern,
  isQueryKey,
} from '../../../Mediator/ApiDirectCall/Flow/Lifecycle/FlowInitCarry.ops.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from '../ApiDirectRuleInput.js';
import { isFlatPattern } from '../FlatPattern.js';
import isUrlComposeValid from '../Validation/ApiDirectUrlComposeValidation.js';
import isUrlPathMapValid from '../Validation/ApiDirectUrlPathMapValidation.js';

/** Widest `padStart` a format rule may ask for. */
const MAX_PAD_START = 64;

/** Op kinds the evaluator runs. */
const KNOWN_OP_KINDS: ReadonlySet<string> = new Set<DerivedOp['kind']>([
  'format',
  'md5-hex',
  'url-query',
  'url-path-map',
  'url-compose',
]);

/**
 * Every derivation of the call, flow init first.
 * @param input - Rule input.
 * @returns The derivations, in config order.
 */
function derivationsOf(input: IApiDirectRuleInput): readonly IDerivedCarry[] {
  const steps = allSteps(input.call);
  const stepDerived = steps.flatMap(step => step.deriveCarry ?? []);
  return [...(input.call.derivedCarry ?? []), ...stepDerived];
}

/**
 * Every derivation op of the call, flow init first.
 * @param input - Rule input.
 * @returns The ops, in config order.
 */
function opsOf(input: IApiDirectRuleInput): readonly DerivedOp[] {
  const derived = derivationsOf(input);
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
 * Whether a query derivation lacks exactly one source or a safe key.
 * @param derived - Derivation config.
 * @returns True for an invalid query derivation.
 */
function isBadQuery(derived: IDerivedCarry): boolean {
  const op = derived.op;
  if (op?.kind !== 'url-query') return false;
  return derived.parts.length !== 1 || !isQueryKey(op.key);
}

/**
 * Whether any query derivation has an invalid source count or key.
 * @param input - Rule input.
 * @returns True when a query derivation is invalid.
 */
function hasBadQuery(input: IApiDirectRuleInput): boolean {
  return derivationsOf(input).some(isBadQuery);
}

/**
 * Whether a query operation declares a malformed blank-value policy.
 * @param op - Derivation operation.
 * @returns True when the optional policy is not true.
 */
function hasBadBlankPolicy(op: DerivedOp): boolean {
  if (op.kind !== 'url-query') return false;
  const policy: unknown = Reflect.get(op, 'rejectBlank');
  return policy !== undefined && policy !== true;
}

/**
 * Whether a URL path mapping lacks one source or valid routing policies.
 * @param derived - Derivation config.
 * @returns True for an invalid path mapping.
 */
function isBadPathMap(derived: IDerivedCarry): boolean {
  const op = derived.op;
  if (op?.kind !== 'url-path-map') return false;
  if (derived.transform !== undefined || derived.truncateBytes !== undefined) return true;
  return derived.parts.length !== 1 || !isUrlPathMapValid(op);
}

/**
 * Whether any URL path mapping is invalid.
 * @param input - Rule input.
 * @returns True when a mapping is invalid.
 */
function hasBadPathMap(input: IApiDirectRuleInput): boolean {
  return derivationsOf(input).some(isBadPathMap);
}

/**
 * Whether a URL composition has invalid policies or source parts.
 * @param derived - Derivation declaration.
 * @returns True for invalid composition.
 */
function isBadCompose(derived: IDerivedCarry): boolean {
  const op = derived.op;
  if (op?.kind !== 'url-compose') return false;
  if (derived.transform !== undefined || derived.truncateBytes !== undefined) return true;
  if (derived.separator !== undefined || !isUrlComposeValid(op)) return true;
  return derived.parts.length !== (op.merge === undefined ? 1 : 3);
}

/**
 * Whether any derivation has an invalid URL composition.
 * @param input - Rule input.
 * @returns True for an invalid composition.
 */
function hasBadCompose(input: IApiDirectRuleInput): boolean {
  return derivationsOf(input).some(isBadCompose);
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
  {
    message: 'derive.op.kind: must be format, md5-hex, url-query, url-path-map or url-compose',
    isBroken: anyOp(isUnknownKind),
  },
  { message: 'derive.op.url-query: needs one part and a valid key', isBroken: hasBadQuery },
  {
    message: 'derive.op.url-query.rejectBlank: must be true when set',
    isBroken: anyOp(hasBadBlankPolicy),
  },
  { message: 'derive.op.url-path-map: invalid mapping', isBroken: hasBadPathMap },
  { message: 'derive.op.url-compose: invalid composition', isBroken: hasBadCompose },
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
