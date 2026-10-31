/**
 * Form-body rules for an api-direct call config (N9). A form body is written
 * field by field, so its shape must be a flat record whose every value is one
 * `$ref`, or one `$literal` string, finite number or boolean. Nesting fails the
 * build; a `$ref` that hydrates to a non-scalar fails the step at run time.
 */

import type {
  IStepConfig,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonUnknownRecord } from '../../Types/JsonValue.js';
import { allSteps, type IApiDirectRule, type IApiDirectRuleInput } from './ApiDirectRuleInput.js';

/**
 * Whether a literal can travel as one form field.
 * @param value - `$literal` payload.
 * @returns True for a string, a finite number or a boolean.
 */
function isScalarLiteral(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a template node is exactly one `$ref` or one scalar `$literal`.
 * @param node - Template node.
 * @returns True for a form leaf.
 */
function isFormLeaf(node: unknown): boolean {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false;
  const leaf = node as JsonUnknownRecord;
  const keys = Object.keys(leaf);
  if (keys.length !== 1) return false;
  if (keys[0] === '$ref') return typeof leaf.$ref === 'string';
  return keys[0] === '$literal' && isScalarLiteral(leaf.$literal);
}

/**
 * Whether a body shape is a record of form leaves.
 * @param shape - Body shape.
 * @returns True when the shape is a flat form record.
 */
function isFlatShape(shape: JsonValueTemplate): boolean {
  if (Array.isArray(shape)) return false;
  const values: readonly unknown[] = Object.values(shape as JsonUnknownRecord);
  return values.every(isFormLeaf);
}

/**
 * Whether a step sends a form its shape cannot fill.
 * @param step - Login step.
 * @returns True for a form step whose shape is not flat.
 */
function isNestedForm(step: IStepConfig): boolean {
  if (step.method === 'GET' || step.encoding !== 'form') return false;
  return !isFlatShape(step.body.shape);
}

/**
 * Whether any login or resume step sends a nested form.
 * @param input - Rule input.
 * @returns True when a form step's shape is not flat.
 */
function hasNestedForm(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(isNestedForm);
}

/** Form-body rules, checked after the session-transport rules. */
const API_DIRECT_FORM_RULES: readonly IApiDirectRule[] = [
  { message: 'steps.body: a form body must be a flat record', isBroken: hasNestedForm },
];

export default API_DIRECT_FORM_RULES;
export { API_DIRECT_FORM_RULES };
