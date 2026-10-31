/**
 * Body-shape rules for an api-direct call config (N9, N23). A form body
 * (`form` or `form-latin1`) is written field by field, so its shape must be a
 * flat record whose every value is one `$ref`, one `$join` (N24), or one
 * `$literal` string, finite number or boolean. A `text` body is sent as one string, so its shape
 * must be exactly `{ text }`. A broken shape fails the build; a value that
 * hydrates to the wrong type fails the step at run time.
 */

import type {
  IStepConfig,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { FORM_BODY_ENCODINGS } from '../../Types/Domain/FetchPolicy.js';
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
 * Whether a `$ref` payload is a token string.
 * @param value - `$ref` payload.
 * @returns True for a string.
 */
function isRefToken(value: unknown): boolean {
  return typeof value === 'string';
}

/**
 * Whether a `$join` payload carries a parts list.
 * @param value - `$join` payload.
 * @returns True for a record with a `parts` array.
 */
function isJoinSpec(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Array.isArray((value as JsonUnknownRecord).parts);
}

/** The payload check of each node key a form field may hold. */
const FORM_LEAF_CHECKS: Readonly<Record<string, (value: unknown) => boolean>> = {
  $ref: isRefToken,
  $literal: isScalarLiteral,
  $join: isJoinSpec,
};

/**
 * Whether a template node is exactly one `$ref`, one `$join` or one scalar
 * `$literal`.
 * @param node - Template node.
 * @returns True for a form leaf.
 */
function isFormLeaf(node: unknown): boolean {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false;
  const leaf = node as JsonUnknownRecord;
  const keys = Object.keys(leaf);
  if (keys.length !== 1 || !Object.hasOwn(FORM_LEAF_CHECKS, keys[0])) return false;
  return FORM_LEAF_CHECKS[keys[0]](leaf[keys[0]]);
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
  if (step.method === 'GET' || !FORM_BODY_ENCODINGS.includes(step.encoding ?? 'json')) {
    return false;
  }
  return !isFlatShape(step.body.shape);
}

/**
 * Whether a body shape is a record whose one field is `text`.
 * @param shape - Body shape.
 * @returns True for exactly `{ text }`.
 */
function isTextShape(shape: JsonValueTemplate): boolean {
  if (Array.isArray(shape)) return false;
  const keys = Object.keys(shape);
  return keys.length === 1 && keys[0] === 'text';
}

/**
 * Whether a step sends a text body its shape cannot fill.
 * @param step - Login step.
 * @returns True for a text step whose shape is not exactly `{ text }`.
 */
function isLooseText(step: IStepConfig): boolean {
  if (step.method === 'GET' || step.encoding !== 'text') return false;
  return !isTextShape(step.body.shape);
}

/**
 * Whether any login or resume step sends a nested form.
 * @param input - Rule input.
 * @returns True when a form step's shape is not flat.
 */
function hasNestedForm(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(isNestedForm);
}

/**
 * Whether any login or resume step sends a text body not shaped `{ text }`.
 * @param input - Rule input.
 * @returns True when a text step's shape is loose.
 */
function hasLooseText(input: IApiDirectRuleInput): boolean {
  return allSteps(input.call).some(isLooseText);
}

/** Body-shape rules, checked after the session-transport rules. */
const API_DIRECT_FORM_RULES: readonly IApiDirectRule[] = [
  { message: 'steps.body: a form body must be a flat record', isBroken: hasNestedForm },
  { message: 'steps.body: a text body must be exactly { text }', isBroken: hasLooseText },
];

export default API_DIRECT_FORM_RULES;
export { API_DIRECT_FORM_RULES };
