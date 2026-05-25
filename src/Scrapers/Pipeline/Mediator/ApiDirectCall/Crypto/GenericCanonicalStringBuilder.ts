/**
 * GenericCanonicalStringBuilder — assembles the canonical string
 * that GenericCryptoSigner signs. Every bank-specific fact lives
 * in ICanonicalStringConfig data (parts order, separator, escape
 * mapping, query-sort flag, client version).
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { JsonValue } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { CanonicalPart, ICanonicalStringConfig } from '../IApiDirectCallConfig.js';

/**
 * Carry slot names read by the symmetric-canonical resolvers. The
 * mediator picks fixed slot names so banks declare canonical parts
 * abstractly (`tsMs`, `deviceId`) without binding to slot literals.
 */
const TS_MS_SLOT = 'tsMs';
const DEVICE_ID_SLOT = 'deviceId16Hex';

/** Args bundle — respects the 3-param ceiling. */
interface IBuildCanonicalArgs {
  readonly canonical: ICanonicalStringConfig;
  readonly pathAndQuery: string;
  readonly bodyJson: string;
  /**
   * Carry snapshot — required when `canonical.parts` includes any
   * symmetric tag (`tsMs`, `deviceId`). Optional otherwise so existing
   * asymmetric callers (Pepper / OneZero) don't change.
   */
  readonly carry?: Readonly<Record<string, JsonValue>>;
}

/** Canonical part resolver — returns the raw (pre-escape) string. */
type PartResolver = (args: IBuildCanonicalArgs) => string;

/** Three-way comparison sentinel returned by {@link compareLocale}. */
type CompareSign = -1 | 0 | 1;

/**
 * Locale-aware comparator wrapping String.localeCompare to satisfy
 * Sonar S2871 ("provide a compare function") while keeping the result
 * a typed CompareSign (Rule #15 forbids primitive number returns).
 * @param a - First string.
 * @param b - Second string.
 * @returns -1 when a < b, 0 when equal, 1 when a > b.
 */
function compareLocale(a: string, b: string): CompareSign {
  const result = a.localeCompare(b);
  if (result < 0) return -1;
  if (result > 0) return 1;
  return 0;
}

/**
 * Sort the query parameters of a path+query string lexicographically.
 * Pure data — used when ICanonicalStringConfig.sortQueryParams is true.
 * @param pathAndQuery - Path + optional `?k=v&…` query.
 * @returns Path with sorted query, or original if no `?`.
 */
function sortQuery(pathAndQuery: string): string {
  const qi = pathAndQuery.indexOf('?');
  if (qi < 0) return pathAndQuery;
  const path = pathAndQuery.slice(0, qi);
  const query = pathAndQuery.slice(qi + 1);
  const params = query.split('&');
  // Explicit localeCompare so canonicalisation is byte-stable across
  // locales (default Array.sort sorts UTF-16 code units, not strings).
  const sorted = [...params].sort(compareLocale);
  const joined = sorted.join('&');
  return `${path}?${joined}`;
}

/**
 * Resolver for the 'pathAndQuery' canonical part.
 * @param args - Build args (uses args.canonical.sortQueryParams).
 * @returns Raw path+query (sorted if configured).
 */
function pathAndQueryResolver(args: IBuildCanonicalArgs): string {
  if (args.canonical.sortQueryParams) return sortQuery(args.pathAndQuery);
  return args.pathAndQuery;
}

/**
 * Resolver for the 'clientVersion' canonical part.
 * @param args - Build args (uses args.canonical.clientVersion).
 * @returns Raw client-version string.
 */
function clientVersionResolver(args: IBuildCanonicalArgs): string {
  return args.canonical.clientVersion;
}

/**
 * Resolver for the 'bodyJson' canonical part.
 * @param args - Build args (uses args.bodyJson).
 * @returns Raw body-JSON string.
 */
function bodyJsonResolver(args: IBuildCanonicalArgs): string {
  return args.bodyJson;
}

/**
 * Read a string slot from the optional carry snapshot. Returns the
 * empty string when carry is absent or the slot is missing — callers
 * surface that as an upstream config error via the empty canonical
 * substring (which the server will reject), keeping this resolver
 * pure-data.
 * @param args - Build args (uses args.carry).
 * @param slot - Carry slot name.
 * @returns Slot value as string (empty when missing).
 */
function readCarryString(args: IBuildCanonicalArgs, slot: string): string {
  const carry = args.carry;
  if (carry === undefined) return '';
  const raw = carry[slot];
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  return '';
}

/**
 * Resolver for the 'tsMs' canonical part — reads carry.tsMs (set by
 * the step-instant primer just before body hydration + signing).
 * @param args - Build args (uses args.carry).
 * @returns Raw tsMs string.
 */
function tsMsResolver(args: IBuildCanonicalArgs): string {
  return readCarryString(args, TS_MS_SLOT);
}

/**
 * Resolver for the 'deviceId' canonical part — reads
 * carry.deviceId16Hex (seeded by the bank's seedCarryFromCreds).
 * @param args - Build args (uses args.carry).
 * @returns Raw deviceId hex string.
 */
function deviceIdResolver(args: IBuildCanonicalArgs): string {
  return readCarryString(args, DEVICE_ID_SLOT);
}

/** Dispatch table for CanonicalPart → resolver. Partial for runtime safety. */
const PART_RESOLVERS: Readonly<Partial<Record<CanonicalPart, PartResolver>>> = {
  pathAndQuery: pathAndQueryResolver,
  clientVersion: clientVersionResolver,
  bodyJson: bodyJsonResolver,
  tsMs: tsMsResolver,
  deviceId: deviceIdResolver,
};

/**
 * Escape literal separator occurrences inside a resolved part.
 * @param raw - Resolver output.
 * @param canonical - Canonical config (escapeFrom + escapeTo).
 * @returns Escaped string safe to join with the separator.
 */
function escapePart(raw: string, canonical: ICanonicalStringConfig): string {
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
