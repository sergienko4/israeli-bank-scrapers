/**
 * v6 per-card identity emitted by SCRAPE.post. Carries the three
 * ids BALANCE-RESOLVE needs to plan its per-bank-account fetches and
 * map the responses back to per-card balances.
 */
interface IAccountIdentity {
  /** Display id — last-4 / account number shown to the user. */
  readonly cardDisplayId: string;
  /** Internal long card id used by the bank API on per-card calls. */
  readonly cardUniqueId: string;
  /** Internal long bank-account id used by per-bank-account balance
   *  fetches (e.g. Visa Cal `getBigNumberAndDetails`). */
  readonly bankAccountUniqueId: string;
}

/**
 * v6 balance fetch template emitted by SCRAPE.post. SCRAPE re-uses
 * the same request shape it already executed during the billing
 * N-loop; BALANCE-RESOLVE substitutes each unique bankAccountUniqueId
 * into the template per-bank-account.
 *
 * <p>One of {postBodyKey, urlQueryKey, urlPathInterpolation} is set:
 *   - `postBodyKey`            POST + JSON body field carries the id
 *   - `urlQueryKey`            GET  + URL query param carries the id
 *   - `urlPathInterpolation`   GET  + URL path segment carries the id
 * All three absent ⇒ bulk endpoint (one call returns every card).
 */
interface IBalanceFetchTemplate {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly postBodyKey?: string;
  readonly urlQueryKey?: string;
  readonly urlPathInterpolation?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
}

/** v6 single live fetch request — fully materialised from the template. */
interface IBalanceFetchRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  /** JSON-encoded POST body, or `''` for GET. */
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * v6 per-bank-account plan entry emitted by BALANCE-RESOLVE.pre and
 * consumed by BALANCE-RESOLVE.action.
 */
interface IBalanceFetchPlanEntry {
  readonly bankAccountUniqueId: string;
  readonly request: IBalanceFetchRequest;
}

/**
 * Per-account extraction outcome. `number` means the extractor
 * found a finite balance value; `'MISS'` means the extractor
 * scanned every candidate (and the per-card record) without a hit.
 */
type BalanceExtractionOutcome = number | 'MISS';

/**
 * Per-account outcome map. Set by BALANCE-RESOLVE.action; consumed
 * by BALANCE-RESOLVE.post.
 */
type IBalanceExtracted = ReadonlyMap<string, BalanceExtractionOutcome>;

/**
 * Validation report from BALANCE-RESOLVE.post. Partitions the
 * extracted outcomes into resolved (finite number) and missed
 * (could not extract). Hard-fail only fires when every account
 * landed in `missedIds`.
 */
interface IBalanceValidation {
  readonly resolvedIds: readonly string[];
  readonly missedIds: readonly string[];
  readonly totalAccounts: number;
}

export type {
  BalanceExtractionOutcome,
  IAccountIdentity,
  IBalanceExtracted,
  IBalanceFetchPlanEntry,
  IBalanceFetchRequest,
  IBalanceFetchTemplate,
  IBalanceValidation,
};
