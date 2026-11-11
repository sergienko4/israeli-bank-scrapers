/**
 * Validates SDK capture allowlists before any request.
 */

/**
 * Whether an unknown value is a non-array record.
 * @param value - Untrusted configuration value.
 * @returns True for a record.
 */
function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether an origin uses the canonical HTTPS origin form.
 * @param value - Untrusted origin.
 * @returns True for an absolute HTTPS origin.
 */
function isOrigin(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parsed = URL.parse(value);
  return parsed?.protocol === 'https:' && parsed.origin === value;
}

/**
 * Whether a value holds only text entries.
 * @param value - Untrusted list.
 * @returns True for an array of strings.
 */
function isTextList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

/**
 * Whether the exact paths can match an absolute URL pathname.
 * @param value - Untrusted path list.
 * @returns True for nonempty absolute paths.
 */
function isPathList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((path: unknown) => typeof path === 'string' && path.startsWith('/'));
}

/**
 * Whether the optional query policy is well formed.
 * @param rule - Untrusted URL rule.
 * @returns True when the query values and flag are valid.
 */
function hasValidQuery(rule: object): boolean {
  const query: unknown = Reflect.get(rule, 'query');
  const exact: unknown = Reflect.get(rule, 'exactQuery');
  if (exact !== undefined && typeof exact !== 'boolean') return false;
  if (query === undefined) return true;
  return (
    isRecord(query) && Object.values(query).every((value: unknown) => typeof value === 'string')
  );
}

/**
 * Whether a rule using `anyPathExcept` omits `paths` and query constraints.
 * @param rule - Untrusted URL rule.
 * @param denied - Candidate `anyPathExcept` list.
 * @returns True when only a non-empty string deny-list is configured.
 */
function hasValidDeniedPaths(rule: object, denied: unknown): boolean {
  if (Reflect.get(rule, 'paths') !== undefined || !isTextList(denied)) return false;
  return Reflect.get(rule, 'query') === undefined && Reflect.get(rule, 'exactQuery') === undefined;
}

/**
 * Whether a rule has one usable path policy.
 * @param rule - Untrusted URL rule.
 * @returns True for an exact-path or denied-path policy.
 */
function hasValidPaths(rule: object): boolean {
  const denied: unknown = Reflect.get(rule, 'anyPathExcept');
  if (denied !== undefined) return hasValidDeniedPaths(rule, denied);
  const paths: unknown = Reflect.get(rule, 'paths');
  return isPathList(paths) && hasValidQuery(rule);
}

/**
 * Whether every SDK allowlist entry can be evaluated safely.
 * @param value - Untrusted URL rules.
 * @returns True for a nonempty list of valid HTTPS URL rules.
 */
function areSdkUrlRulesValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((rule: unknown) => {
    if (!isRecord(rule)) return false;
    const origin: unknown = Reflect.get(rule, 'origin');
    return isOrigin(origin) && hasValidPaths(rule);
  });
}

export default areSdkUrlRulesValid;
export { areSdkUrlRulesValid };
