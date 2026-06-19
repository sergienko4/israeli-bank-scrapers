/**
 * BALANCE-RESOLVE — declared balance "kind" per bank plus the
 * alias-family filter that scopes balance discovery to that kind.
 *
 * R1 hardening: the WK balance-alias lists order account aliases
 * (`AccountBalance`, `balance`, …) BEFORE card-cycle debits
 * (`nextTotalDebit`, `totalDebit`, …). A card bank whose response
 * carries an incidental account-ish field would otherwise resolve
 * that field first. Each bank declares a {@link BalanceKind}; the
 * extractor PREFERS the matching family — a card bank never bleeds
 * onto an account alias while an in-family debit is present — and
 * falls back to the full alias list only when the family scan finds
 * nothing, so a bank whose balance legitimately lives under a
 * cross-family alias (e.g. an account balance folded under the
 * card-shared `totalAmount`) still resolves.
 *
 * Dependency-free by design — imports no alias list — so both the
 * BALANCE-RESOLVE and SCRAPE seams can consume it without a circular
 * import.
 */

/**
 * Balance semantics a bank exposes.
 *  - `account` — a real running account balance (current-account banks).
 *  - `card-cycle` — a credit-card billing-cycle debit total.
 */
export type BalanceKind = 'account' | 'card-cycle';

/** Canonical {@link BalanceKind} for running deposit/checking accounts. */
export const ACCOUNT_KIND: BalanceKind = 'account';

/** Canonical {@link BalanceKind} for credit-card billing-cycle balances. */
export const CARD_CYCLE_KIND: BalanceKind = 'card-cycle';

/**
 * Account-family balance aliases — running-balance style fields.
 * Disjoint from {@link CARD_CYCLE_BALANCE_FAMILY}; together the two
 * families partition the full WK balance-alias surface.
 *
 * `BalanceDisplay` is the PRIMARY-resolver account alias for browser
 * banks that fold the balance into the transactions response (no
 * separate balance endpoint). It lives in the account family so
 * `scopedResolveBalanceAliases('account')` keeps it — dropping it
 * would silently regress those account banks' resolved balance.
 */
export const ACCOUNT_BALANCE_FAMILY: ReadonlySet<string> = new Set([
  'AccountBalance',
  'balance',
  'currentBalance',
  'balanceAmount',
  'withdrawableBalance',
  'runningBalance',
  'currentAccountBalance',
  'closingBalance',
  'BalanceDisplay',
]);

/**
 * Card-cycle-family balance aliases — billing-cycle debit totals.
 * Disjoint from {@link ACCOUNT_BALANCE_FAMILY}.
 */
export const CARD_CYCLE_BALANCE_FAMILY: ReadonlySet<string> = new Set([
  'nextTotalDebit',
  'totalDebit',
  'currentDebit',
  'currentBillingAmount',
  'totalAmount',
  'billingSumSekel',
  'totalIlsBillingDate',
]);

/** Maps a declared {@link BalanceKind} to its alias family. */
const FAMILY_BY_KIND: Readonly<Record<BalanceKind, ReadonlySet<string>>> = {
  account: ACCOUNT_BALANCE_FAMILY,
  'card-cycle': CARD_CYCLE_BALANCE_FAMILY,
};

/**
 * Scope a balance-alias list to the bank's declared kind. Returns the
 * subset of `aliases` whose members belong to the kind's family —
 * order-preserving and never adding an alias the base list lacked, so
 * the result is always a behaviour-preserving restriction.
 * @param aliases - Base balance-alias list (a path's full WK list).
 * @param kind - The bank's declared balance kind.
 * @returns Family-scoped alias list (a subset of `aliases`).
 */
export function scopeAliasesByKind(
  aliases: readonly string[],
  kind: BalanceKind,
): readonly string[] {
  const family = FAMILY_BY_KIND[kind];
  return aliases.filter((alias): boolean => family.has(alias));
}
