/**
 * Optional-ref rule for an api-direct call config (N49). An optional `$ref`
 * leaves its key out when its source is absent, so it may stand only as the
 * value of a key in a step's body or query template. One at a body or query
 * root, inside an array, or anywhere in a header fails the build. A
 * `$literal` or `$join` payload is not walked: it holds data, not nodes, and
 * a `$join` part or a raw query names ref tokens, never `$ref` nodes.
 */

import type { IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { anyStep, type IApiDirectRule } from './ApiDirectRuleInput.js';

/** Node keys whose payload is data, never a template node. */
const DATA_KEYS = ['$literal', '$join'] as const;

/** Where the walk stands: whether a key may hold an optional ref, and is one. */
interface IPlacement {
  readonly keysAllowed: boolean;
  readonly isKeyValue: boolean;
}

const ROOT_OF_BODY: IPlacement = { keysAllowed: true, isKeyValue: false };
const ROOT_OF_HEADER: IPlacement = { keysAllowed: false, isKeyValue: false };

/**
 * Whether a `$ref` node is marked optional.
 * @param node - `$ref` node.
 * @returns True for `optional: true`.
 */
function isOptionalRef(node: object): boolean {
  return (node as { readonly optional?: unknown }).optional === true;
}

/**
 * Whether a template holds an optional ref anywhere it may not stand.
 * @param node - Template node, or nothing.
 * @param place - Where the node stands.
 * @returns True for an optional ref off an allowed key value.
 */
function holdsStrayOptional(node: unknown, place: IPlacement): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const canStand = place.keysAllowed && place.isKeyValue;
  if (Object.hasOwn(node, '$ref')) return isOptionalRef(node) && !canStand;
  if (DATA_KEYS.some((key): boolean => Object.hasOwn(node, key))) return false;
  const inner: IPlacement = { ...place, isKeyValue: !Array.isArray(node) };
  const children: readonly unknown[] = Object.values(node);
  return children.some((child): boolean => holdsStrayOptional(child, inner));
}

/**
 * Whether a step holds an optional ref off a body or query key.
 * @param step - Login or resume step.
 * @returns True for a stray one in its body, query template or headers.
 */
function hasStrayOptional(step: IStepConfig): boolean {
  const body = step.method === 'GET' ? {} : step.body.shape;
  const templates: readonly unknown[] = [body, step.queryTemplate];
  const headers: readonly unknown[] = Object.values(step.headers ?? {});
  const isStrayTemplate = templates.some((t): boolean => holdsStrayOptional(t, ROOT_OF_BODY));
  return isStrayTemplate || headers.some((h): boolean => holdsStrayOptional(h, ROOT_OF_HEADER));
}

/** Optional-ref rule, checked after the step URL rules. */
const API_DIRECT_OPTIONAL_REF_RULES: readonly IApiDirectRule[] = [
  {
    message: 'steps: optional ref only as an object value',
    isBroken: anyStep(hasStrayOptional),
  },
];

export default API_DIRECT_OPTIONAL_REF_RULES;
export { API_DIRECT_OPTIONAL_REF_RULES };
