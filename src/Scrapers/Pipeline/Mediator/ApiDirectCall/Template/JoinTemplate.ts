/**
 * JoinTemplate — hydrates a `$join` node to one string: the parts
 * concatenated (refs resolved, literals kept), base64 over the UTF-8 bytes
 * when `encode` is `base64`, behind `prefix`. A part that is unresolved or
 * not a string fails hydration like a missing `$ref`. The value lives only
 * in the hydrated body or header — nothing writes it to carry.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type {
  IJoinTemplate,
  JoinEncoding,
  JoinPart,
  JsonValueTemplate,
} from '../ConfigContracts/index.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import { type ITemplateScope, resolveRef } from './RefResolver.js';

/** Turns the joined text into the hydrated value. */
type JoinEncoder = (text: string) => string;

/**
 * Keep the joined text as it is.
 * @param text - Joined text.
 * @returns The same text.
 */
const PLAIN: JoinEncoder = text => text;

/**
 * Base64 over the UTF-8 bytes of the joined text.
 * @param text - Joined text.
 * @returns Base64 text.
 */
function toBase64(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  return bytes.toString('base64');
}

/** One encoder per `encode` value; `plain` when it is absent. */
const JOIN_ENCODERS: Readonly<Record<JoinEncoding | 'plain', JoinEncoder>> = {
  plain: PLAIN,
  base64: toBase64,
};

/**
 * Resolve one part to its text.
 * @param part - Ref token or literal part.
 * @param scope - Template scope.
 * @returns Procedure with the part text.
 */
function partText(part: JoinPart, scope: ITemplateScope): Procedure<string> {
  if (typeof part !== 'string') return succeed(part.literal);
  const resolved = resolveRef(part, scope);
  if (!isOk(resolved)) return resolved;
  if (typeof resolved.value === 'string') return succeed(resolved.value);
  return fail(ScraperErrorTypes.Generic, `$join part ${part} is not a string`);
}

/**
 * Append one part's text to the join so far.
 * @param scope - Template scope.
 * @param acc - Join so far.
 * @param part - Next part.
 * @returns Updated join.
 */
function absorbPart(
  scope: ITemplateScope,
  acc: Procedure<string>,
  part: JoinPart,
): Procedure<string> {
  if (!isOk(acc)) return acc;
  const text = partText(part, scope);
  if (!isOk(text)) return text;
  return succeed(acc.value + text.value);
}

/**
 * Concatenate every part's text in order.
 * @param parts - Join parts.
 * @param scope - Template scope.
 * @returns Procedure with the joined text, or the first part's failure.
 */
function joinParts(parts: readonly JoinPart[], scope: ITemplateScope): Procedure<string> {
  const seed: Procedure<string> = succeed('');
  return parts.reduce<Procedure<string>>((acc, part) => absorbPart(scope, acc, part), seed);
}

/**
 * Hydrate a `$join` node.
 * @param node - Template node of the form { $join: IJoinTemplate }.
 * @param scope - Template scope.
 * @returns Procedure with the joined string.
 */
function hydrateJoin(node: JsonValueTemplate, scope: ITemplateScope): Procedure<JsonValue> {
  const spec = (node as { readonly $join: IJoinTemplate }).$join;
  const joined = joinParts(spec.parts, scope);
  if (!isOk(joined)) return joined;
  const encode = JOIN_ENCODERS[spec.encode ?? 'plain'];
  const encoded = encode(joined.value);
  return succeed(`${spec.prefix ?? ''}${encoded}`);
}

export { hydrateJoin };
export default hydrateJoin;
