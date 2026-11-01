/**
 * MergeTemplate — hydrates a `$merge` node (N37): the carried flat string
 * record `base` with the hydrated `set` laid over it. A `set` key replaces the
 * base value in place and a new one goes last, as `URLSearchParams.set` does
 * on a form with unique names. A base that is not a flat record of strings
 * fails `"$merge base <token> not a flat string record"`, naming no value. The
 * set hydrator is passed in, so this module never imports GenericBodyTemplate.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IProcedureFailure, Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { IMergeTemplate, JsonValueTemplate } from '../ConfigContracts/index.js';
import type { IJsonObject, JsonValue } from '../Envelope/JsonPointer.js';
import { isPlainObject } from '../Envelope/JsonPointer.js';
import type { ITemplateScope } from './RefResolver.js';
import { resolveRef } from './RefResolver.js';

/** Hydrates a `set` record against a scope; always answers a record. */
type SetHydrator = (set: JsonValueTemplate, scope: ITemplateScope) => Procedure<JsonValue>;

/** What hydrateMerge needs, bundled to keep its signature short. */
interface IMergeArgs {
  /** Template node of the form { $merge: IMergeTemplate }. */
  readonly node: JsonValueTemplate;
  /** Template scope. */
  readonly scope: ITemplateScope;
  /** Hydrates the `set` record. */
  readonly hydrateSet: SetHydrator;
}

/**
 * Whether a carried value is a record of strings.
 * @param value - Resolved base.
 * @returns True for a plain record whose every value is a string.
 */
function isFlatStrings(value: JsonValue): value is IJsonObject {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((field): boolean => typeof field === 'string');
}

/**
 * Fail a base that is not a flat string record, naming the token only.
 * @param base - The base ref token.
 * @returns Generic failure.
 */
function refuseBase(base: IMergeTemplate['base']): IProcedureFailure {
  return fail(ScraperErrorTypes.Generic, `$merge base ${base} not a flat string record`);
}

/**
 * Hydrate a `$merge` node.
 * @param args - {@link IMergeArgs} bundle.
 * @returns Procedure with the merged record.
 */
function hydrateMerge(args: IMergeArgs): Procedure<JsonValue> {
  const { node, scope, hydrateSet } = args;
  const { base, set } = (node as { readonly $merge: IMergeTemplate }).$merge;
  const resolved = resolveRef(base, scope);
  if (!isOk(resolved)) return resolved;
  if (!isFlatStrings(resolved.value)) return refuseBase(base);
  const overlay = hydrateSet(set, scope);
  if (!isOk(overlay)) return overlay;
  return succeed({ ...resolved.value, ...(overlay.value as IJsonObject) });
}

export default hydrateMerge;
export { hydrateMerge };
