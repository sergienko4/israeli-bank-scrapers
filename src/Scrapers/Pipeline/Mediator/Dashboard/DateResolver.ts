/**
 * DateResolver — resolves date tokens in proxy query params.
 * Tokens: YYYY → year, MM → zero-padded month, DD → zero-padded day.
 * Compound: YYYY-MM-01 → 2026-04-01 (first of month).
 * Generic — works for any bank, any date format.
 */

/** Resolved date string. */
type DateStr = string;
/** Raw token value from config. */
type TokenValue = string;

/**
 * Resolve a single token value — replaces YYYY, MM, DD with date parts.
 * @param token - Token string (e.g. 'YYYY-MM-01', 'MM', 'YYYY').
 * @param date - Target date.
 * @returns Resolved string.
 */
function resolveToken(token: TokenValue, date: Date): DateStr {
  const fullYear = date.getFullYear();
  const yyyy = String(fullYear);
  const rawMonth = date.getMonth() + 1;
  const mm = String(rawMonth).padStart(2, '0');
  const rawDay = date.getDate();
  const dd = String(rawDay).padStart(2, '0');
  return token.replaceAll('YYYY', yyyy).replaceAll('MM', mm).replaceAll('DD', dd);
}

/**
 * Resolve all date tokens in a params record.
 * @param params - Token-based params (e.g. { billingDate: 'YYYY-MM-01' }).
 * @param date - Target date for token resolution.
 * @returns Resolved params with real date values.
 */
function resolveDateTokens(
  params: Readonly<Record<string, string>>,
  date: Date,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, token] of Object.entries(params)) {
    resolved[key] = resolveToken(token, date);
  }
  return resolved;
}

export { resolveDateTokens, resolveToken };
