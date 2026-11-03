/**
 * Case-insensitive header overlay. Fetch joins two header keys that differ
 * only in letter case into one comma-separated value, so every merge where
 * one bag must win a name clash goes through {@link overlayHeaders}.
 */

/** A header map keyed by header name. */
type HeaderMap = Readonly<Record<string, string>>;

/**
 * Whether a header name is in a set of lower-case names, in any letter case.
 * @param names - Lower-case header names.
 * @param name - Header name to look up.
 * @returns True when the name is in the set.
 */
function hasName(names: ReadonlySet<string>, name: string): boolean {
  const lower = name.toLowerCase();
  return names.has(lower);
}

/**
 * Lay `top` over `base`: a `top` header replaces a `base` header of the
 * same name in any letter case, so fetch never sends both values.
 * @param base - Lower-priority headers.
 * @param top - Headers that win a name clash.
 * @returns The merged header map.
 */
function overlayHeaders(base: HeaderMap, top: HeaderMap): Record<string, string> {
  const topKeys = Object.keys(top);
  const topNames = new Set(topKeys.map((name): string => name.toLowerCase()));
  const kept = Object.entries(base).filter(([name]): boolean => !hasName(topNames, name));
  const baseKept = Object.fromEntries(kept);
  return { ...baseKept, ...top };
}

export default overlayHeaders;
export { overlayHeaders };
