/**
 * BancsPortfolioAccount — derives Bank Yahav's customer-facing account
 * number from a BaNCS portfolio handle.
 *
 * <p>Yahav's `/BaNCSDigitalApp/account` response surfaces the bank's
 * INTERNAL handle (`AccountId.iorId` / `AccountId.Id.Id`) where every
 * other bank surfaces a customer-visible number. The real customer
 * account is the BaNCS portfolio `04131490974`, present at
 * `Payload.RefDataList[*].Id` AND as the leading 11-char run of any
 * `BANKACCOUNTID` (`04131490974CA005ILS0001`). Stripping the `04`
 * prefix yields `131490974` → branch `131` + account `490974`.
 *
 * <p>{@link BANCS_PORTFOLIO_RE} is the structural gate: only Yahav's
 * BaNCS responses carry an `04`+9-digit portfolio, so the derivation
 * is inert for the 18 other banks by construction (OCP — no
 * bank-name keying).
 */

/** Matches a BaNCS portfolio handle: the literal `04` plus 9 digits. */
export const BANCS_PORTFOLIO_RE = /^04\d{9}$/;

/** Length of the portfolio run that prefixes a `BANKACCOUNTID` value. */
const PORTFOLIO_LEN = 11;

/** Derived Yahav account: the 6-digit number plus its `branch-account` display. */
interface IBancsAccount {
  readonly accountNumber: string;
  readonly display: string;
}

/**
 * True iff `value` is a plain (non-array) object.
 * @param value - Candidate JSON node.
 * @returns True iff `value` is a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Return `raw` when it is exactly an `04`+9-digit portfolio, else false.
 * @param raw - Candidate token.
 * @returns Portfolio token or false.
 */
function testToken(raw: string): string | false {
  return BANCS_PORTFOLIO_RE.test(raw) ? raw : false;
}

/**
 * Resolve a string leaf to a portfolio token. `BANKACCOUNTID` values
 * carry trailing currency/branch noise, so only their leading 11-char
 * run is tested; every other key is tested whole.
 * @param key - Owning JSON key.
 * @param value - String leaf value.
 * @returns Portfolio token or false.
 */
function tokenForKey(key: string, value: string): string | false {
  if (key.toUpperCase() !== 'BANKACCOUNTID') return testToken(value);
  const lead = value.slice(0, PORTFOLIO_LEN);
  return testToken(lead);
}

/**
 * Return the first non-false result of `fn` across `items`.
 * @param items - Items to probe in order.
 * @param fn - Probe returning a portfolio token or false.
 * @returns First portfolio token, or false when none hit.
 */
function firstHit<T>(items: readonly T[], fn: (item: T) => string | false): string | false {
  const results = items.map(fn);
  const hit = results.find((r): boolean => r !== false);
  return hit ?? false;
}

/**
 * Recursively scan a JSON node for the first BaNCS portfolio token.
 * @param key - Key owning `value` (drives `BANKACCOUNTID` trimming).
 * @param value - JSON node at any depth.
 * @returns First portfolio token, or false.
 */
function scanNode(key: string, value: unknown): string | false {
  if (typeof value === 'string') return tokenForKey(key, value);
  if (Array.isArray(value)) return firstHit(value, (item): string | false => scanNode(key, item));
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return firstHit(entries, ([k, v]): string | false => scanNode(k, v));
}

/**
 * Extract the BaNCS portfolio handle (`04`+9 digits) from a response
 * body, or false when the body carries none (every non-Yahav bank).
 * @param body - Parsed JSON response body.
 * @returns Portfolio token or false.
 */
export function extractPortfolioId(body: unknown): string | false {
  return scanNode('', body);
}

/**
 * Derive the customer-facing account from a BaNCS portfolio handle.
 * Strips the `04` prefix, then splits the 9-digit remainder into a
 * 3-digit branch and a 6-digit account.
 * @param portfolio - Portfolio handle, e.g. `04131490974`.
 * @returns Account number and `branch-account` display form.
 */
export function deriveBancsAccount(portfolio: string): IBancsAccount {
  const digits = portfolio.slice(2);
  const branch = digits.slice(0, 3);
  const account = digits.slice(3);
  return { accountNumber: account, display: `${branch}-${account}` };
}

/**
 * Override the displayed account ids with the derived BaNCS account
 * when the body carries a portfolio handle; otherwise return `ids`
 * unchanged so the 18 other banks stay byte-identical.
 * @param body - Parsed JSON response body.
 * @param ids - Display ids extracted by the generic WK walker.
 * @returns Derived single-account id list, or `ids` unchanged.
 */
export function deriveBancsDisplayIds(body: unknown, ids: readonly string[]): readonly string[] {
  const portfolio = extractPortfolioId(body);
  if (portfolio === false) return ids;
  const derived = deriveBancsAccount(portfolio).accountNumber;
  return ids.length <= 1 ? [derived] : [derived, ...ids.slice(1)];
}
