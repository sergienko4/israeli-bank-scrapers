/**
 * GenericCanonicalStringBuilder — assembles the canonical string
 * that GenericCryptoSigner signs. Every bank-specific fact lives
 * in ICanonicalStringConfig data (parts order, separator, escape
 * mapping, query-sort flag, client version).
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { CanonicalPart, ICanonicalStringConfig } from '../IApiDirectCallConfig.js';

/** Args bundle — respects the 3-param ceiling. */
interface IBuildCanonicalArgs {
  readonly canonical: ICanonicalStringConfig;
  readonly pathAndQuery: string;
  readonly bodyJson: string;
}

/** Raw (pre-escape) canonical fragment contributed by one part. */
type CanonicalFragment = string;

/** Path + optional query (as both input and output of sortQuery). */
type PathAndQueryStr = string;

/** Canonical part resolver — returns the raw (pre-escape) string. */
type PartResolver = (args: IBuildCanonicalArgs) => CanonicalFragment;

/**
 * Sort the query parameters of a path+query string lexicographically.
 * Pure data — used when ICanonicalStringConfig.sortQueryParams is true.
 * @param pathAndQuery - Path + optional `?k=v&…` query.
 * @returns Path with sorted query, or original if no `?`.
 */
function sortQuery(pathAndQuery: string): PathAndQueryStr {
  const qi = pathAndQuery.indexOf('?');
  if (qi < 0) return pathAndQuery;
  const path = pathAndQuery.slice(0, qi);
  const query = pathAndQuery.slice(qi + 1);
  const params = query.split('&');
  const sorted = [...params].sort();
  const joined = sorted.join('&');
  return `${path}?${joined}`;
}

/**
 * Resolver for the 'pathAndQuery' canonical part.
 * @param args - Build args (uses args.canonical.sortQueryParams).
 * @returns Raw path+query (sorted if configured).
 */
function pathAndQueryResolver(args: IBuildCanonicalArgs): CanonicalFragment {
  if (args.canonical.sortQueryParams) return sortQuery(args.pathAndQuery);
  return args.pathAndQuery;
}

/**
 * Resolver for the 'clientVersion' canonical part.
 * @param args - Build args (uses args.canonical.clientVersion).
 * @returns Raw client-version string.
 */
function clientVersionResolver(args: IBuildCanonicalArgs): CanonicalFragment {
  return args.canonical.clientVersion;
}

/**
 * Resolver for the 'bodyJson' canonical part.
 * @param args - Build args (uses args.bodyJson).
 * @returns Raw body-JSON string.
 */
function bodyJsonResolver(args: IBuildCanonicalArgs): CanonicalFragment {
  return args.bodyJson;
}

/** Dispatch table for CanonicalPart → resolver. Partial for runtime safety. */
const PART_RESOLVERS: Readonly<Partial<Record<CanonicalPart, PartResolver>>> = {
  pathAndQuery: pathAndQueryResolver,
  clientVersion: clientVersionResolver,
  bodyJson: bodyJsonResolver,
};

/**
 * Escape literal separator occurrences inside a resolved part.
 * @param raw - Resolver output.
 * @param canonical - Canonical config (escapeFrom + escapeTo).
 * @returns Escaped string safe to join with the separator.
 */
function escapePart(raw: string, canonical: ICanonicalStringConfig): CanonicalFragment {
  return raw.replaceAll(canonical.escapeFrom, canonical.escapeTo);
}

/**
 * Resolve one CanonicalPart through the dispatch table + escape step.
 * @param part - Tag from canonical.parts.
 * @param args - Build args.
 * @returns Procedure with the escaped part, or unknown-part failure.
 */
function resolvePart(part: CanonicalPart, args: IBuildCanonicalArgs): Procedure<string> {
  const resolver = PART_RESOLVERS[part];
  if (resolver === undefined) {
    return fail(ScraperErrorTypes.Generic, `unknown canonical part: ${part as string}`);
  }
  const raw = resolver(args);
  const escaped = escapePart(raw, args.canonical);
  return succeed(escaped);
}

/**
 * Reducer over parts — short-circuits on the first unknown part.
 * @param args - Build args.
 * @param acc - Accumulated parts procedure.
 * @param part - Next CanonicalPart to resolve.
 * @returns Updated accumulator procedure.
 */
function reducePart(
  args: IBuildCanonicalArgs,
  acc: Procedure<readonly string[]>,
  part: CanonicalPart,
): Procedure<readonly string[]> {
  if (!acc.success) return acc;
  const next = resolvePart(part, args);
  if (!next.success) return next;
  return succeed([...acc.value, next.value]);
}

/**
 * Assemble the canonical string from parts + separator.
 * @param args - Build args.
 * @returns Procedure with the canonical string, or unknown-part failure.
 */
function buildCanonical(args: IBuildCanonicalArgs): Procedure<string> {
  const seed: Procedure<readonly string[]> = succeed([]);
  const outcome = args.canonical.parts.reduce<Procedure<readonly string[]>>(
    (acc, part) => reducePart(args, acc, part),
    seed,
  );
  if (!outcome.success) return outcome;
  const joined = outcome.value.join(args.canonical.separator);
  return succeed(joined);
}

export type { IBuildCanonicalArgs };
export default buildCanonical;
export { buildCanonical };
