/**
 * GenericBodyTemplate — recursive descent that hydrates a
 * JsonValueTemplate against an ITemplateScope. Handles three node
 * shapes:
 *   { $literal: JsonValue }      — pass value through
 *   { $ref: RefToken }           — resolve via RefResolver
 *   plain record                 — recurse each entry
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { JsonValueTemplate, RefToken } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from './RefResolver.js';
import { resolveRef } from './RefResolver.js';

/** Discriminator for template nodes — one of the four shapes above. */
type TemplateShape = 'literal' | 'ref' | 'array' | 'record';

/** Acceptable literal-value shapes carried by `$literal` nodes. */
type LiteralValue = JsonValue | object;

/**
 * Coerce a template-literal value to JsonValue if safe.
 * @param value - Candidate value (must be a supported literal type).
 * @returns Procedure with the coerced value.
 */
function coerceJson(value: LiteralValue): Procedure<JsonValue> {
  if (value === null) return succeed(null);
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return succeed(value as JsonValue);
  if (t === 'object') return succeed(value as JsonValue);
  return fail(ScraperErrorTypes.Generic, `template literal not JSON-serialisable: ${t}`);
}

/**
 * Classify a template node — $literal / $ref / record / invalid.
 * @param node - Template node to inspect.
 * @returns Discriminator.
 */
function classify(node: JsonValueTemplate): TemplateShape {
  if (Array.isArray(node)) return 'array';
  if (typeof node !== 'object') return 'record';
  const asRec = node as Record<string, unknown>;
  if (Object.hasOwn(asRec, '$literal')) return 'literal';
  if (Object.hasOwn(asRec, '$ref')) return 'ref';
  return 'record';
}

/**
 * Hydrate a $literal node.
 * @param node - Template node of the form { $literal: ... }.
 * @returns Procedure with the literal value coerced to JsonValue.
 */
function hydrateLiteral(node: JsonValueTemplate): Procedure<JsonValue> {
  const asLit = node as { readonly $literal: LiteralValue };
  return coerceJson(asLit.$literal);
}

/**
 * Hydrate a $ref node.
 * @param node - Template node of the form { $ref: RefToken }.
 * @param scope - Template scope.
 * @returns Procedure with the resolved value.
 */
function hydrateRef(node: JsonValueTemplate, scope: ITemplateScope): Procedure<JsonValue> {
  const asRef = node as { readonly $ref: RefToken };
  return resolveRef(asRef.$ref, scope);
}

/**
 * Absorb one record-entry hydration into the accumulator.
 * @param scope - Template scope.
 * @param acc - Accumulated record (success so far).
 * @param entry - [key, child-template] pair.
 * @returns Updated accumulator.
 */
function absorbEntry(
  scope: ITemplateScope,
  acc: Procedure<Record<string, JsonValue>>,
  entry: readonly [string, JsonValueTemplate],
): Procedure<Record<string, JsonValue>> {
  if (!isOk(acc)) return acc;
  const [key, child] = entry;
  const hydrated = hydrate(child, scope);
  if (!isOk(hydrated)) return hydrated;
  return succeed({ ...acc.value, [key]: hydrated.value });
}

/**
 * Hydrate a plain-record node — recurse each entry.
 * @param node - Template node (plain record, not $literal / $ref).
 * @param scope - Template scope.
 * @returns Procedure with the hydrated object.
 */
function hydrateRecord(node: JsonValueTemplate, scope: ITemplateScope): Procedure<JsonValue> {
  const entries = Object.entries(node as Record<string, JsonValueTemplate>);
  const seed: Procedure<Record<string, JsonValue>> = succeed({});
  const outcome = entries.reduce<Procedure<Record<string, JsonValue>>>(
    (acc, entry) => absorbEntry(scope, acc, entry),
    seed,
  );
  if (!outcome.success) return outcome;
  return succeed(outcome.value);
}

/**
 * Absorb one array-element hydration into the accumulator.
 * @param scope - Template scope.
 * @param acc - Accumulated array so far.
 * @param child - Next child template.
 * @returns Updated accumulator.
 */
function absorbArrayItem(
  scope: ITemplateScope,
  acc: Procedure<readonly JsonValue[]>,
  child: JsonValueTemplate,
): Procedure<readonly JsonValue[]> {
  if (!isOk(acc)) return acc;
  const hydrated = hydrate(child, scope);
  if (!isOk(hydrated)) return hydrated;
  return succeed([...acc.value, hydrated.value]);
}

/**
 * Hydrate an array-shaped template node — recurse each element.
 * @param node - Template node (must be Array.isArray true).
 * @param scope - Template scope.
 * @returns Procedure with the hydrated array.
 */
function hydrateArray(node: JsonValueTemplate, scope: ITemplateScope): Procedure<JsonValue> {
  const items = node as unknown as readonly JsonValueTemplate[];
  const seed: Procedure<readonly JsonValue[]> = succeed([]);
  const outcome = items.reduce<Procedure<readonly JsonValue[]>>(
    (acc, child) => absorbArrayItem(scope, acc, child),
    seed,
  );
  if (!outcome.success) return outcome;
  return succeed(outcome.value as JsonValue);
}

/** Hydrator entry signature — each shape dispatcher matches this. */
type ShapeHydrator = (node: JsonValueTemplate, scope: ITemplateScope) => Procedure<JsonValue>;

/**
 * Literal-shape dispatch — scope is accepted only to match ShapeHydrator.
 * @param node - Template node.
 * @returns Procedure.
 */
const DISPATCH_LITERAL: ShapeHydrator = node => hydrateLiteral(node);

/** Hydrator registry — one entry per TemplateShape. */
const SHAPE_HYDRATORS: Readonly<Record<TemplateShape, ShapeHydrator>> = {
  literal: DISPATCH_LITERAL,
  ref: hydrateRef,
  array: hydrateArray,
  record: hydrateRecord,
};

/**
 * Hydrate a JsonValueTemplate against a scope.
 * @param template - Template root (any shape).
 * @param scope - Template scope.
 * @returns Procedure with the hydrated JsonValue.
 */
function hydrate(template: JsonValueTemplate, scope: ITemplateScope): Procedure<JsonValue> {
  const shape = classify(template);
  return SHAPE_HYDRATORS[shape](template, scope);
}

export { hydrate };
export default hydrate;
