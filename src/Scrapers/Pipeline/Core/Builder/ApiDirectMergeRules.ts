/**
 * `$merge` rules for an api-direct call config. A `$merge` node may only
 * be a form body's whole shape — `form` or `form-latin1` — where the form-body
 * rules check its `carry.` base and flat `set`. One anywhere else — a JSON or
 * text body, a form field or the `set` itself, a header or a query — fails the
 * build. A `$literal`, `$ref` or `$join` payload is not walked: it holds data,
 * not nodes.
 */

import type {
  IStepConfig,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { FORM_BODY_ENCODINGS } from '../../Types/Domain/FetchPolicy.js';
import type { JsonUnknownRecord } from '../../Types/JsonValue.js';
import { anyStep, type IApiDirectRule } from './ApiDirectRuleInput.js';

/** Node keys whose payload is data, never a template node. */
const LEAF_KEYS = ['$literal', '$ref', '$join'] as const;

/**
 * Whether a body shape is exactly one `$merge` node.
 * @param shape - Body shape.
 * @returns True for a record whose one key is `$merge`.
 */
function isMergeRoot(shape: JsonValueTemplate): boolean {
  if (Array.isArray(shape)) return false;
  const keys = Object.keys(shape);
  return keys.length === 1 && keys[0] === '$merge';
}

/**
 * Whether a template holds a `$merge` node anywhere.
 * @param node - Template node, or nothing.
 * @returns True when a `$merge` key sits outside every leaf payload.
 */
function holdsMerge(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  if (Object.hasOwn(node, '$merge')) return true;
  if (LEAF_KEYS.some((key): boolean => Object.hasOwn(node, key))) return false;
  const children: readonly unknown[] = Object.values(node);
  return children.some(holdsMerge);
}

/**
 * The part of a step's body the walk reads: a form `$merge` root's payload,
 * else the whole shape.
 * @param step - Login step.
 * @returns The body to walk; {} for a GET step.
 */
function walkedBodyOf(step: IStepConfig): unknown {
  if (step.method === 'GET') return {};
  const { shape } = step.body;
  const isForm = FORM_BODY_ENCODINGS.includes(step.encoding ?? 'json');
  if (!isForm || !isMergeRoot(shape)) return shape;
  return (shape as JsonUnknownRecord).$merge;
}

/**
 * Whether a step holds a `$merge` off a form body's root.
 * @param step - Login step.
 * @returns True for a `$merge` in its body past a form root, its headers or its query.
 */
function hasStrayMerge(step: IStepConfig): boolean {
  const headers: readonly unknown[] = Object.values(step.headers ?? {});
  const body = walkedBodyOf(step);
  return [body, step.queryTemplate, ...headers].some(holdsMerge);
}

/** `$merge` rules, checked after the form-body rules. */
const API_DIRECT_MERGE_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps: $merge belongs only at the root of a form body',
    isBroken: anyStep(hasStrayMerge),
  },
];

export default API_DIRECT_MERGE_RULES;
export { API_DIRECT_MERGE_RULES, isMergeRoot };
