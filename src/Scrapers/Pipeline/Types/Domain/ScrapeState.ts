import type { ITransactionsAccount } from '../../../../Transactions.js';
import type { IAccountIdentity, IBalanceFetchTemplate } from './BalanceTypes.js';

/** Scrape phase result context. */
interface IScrapeState {
  readonly accounts: readonly ITransactionsAccount[];
  /**
   * Per-card identity triples committed by SCRAPE.post — v6 contract.
   *
   * <p>BALANCE-RESOLVE consumes this map to plan per-bank-account
   * balance fetches. SCRAPE emits identity data only; no attribution,
   * no scoring, no extractor work — single-phase ownership of balance
   * is enforced in BALANCE-RESOLVE.
   *
   * <p>Absent (`undefined`) when SCRAPE could not derive identities
   * (no accountDiscovery, frozen test paths). Downstream consumers
   * treat the absent case as a soft signal and default-deny.
   */
  readonly accountIdentities?: ReadonlyMap<string, IAccountIdentity>;
  /**
   * Balance fetch template committed by SCRAPE.post — v6 contract.
   *
   * <p>The template carries the URL + method + post-body / url-query
   * key SCRAPE already used during the billing N-loop. BALANCE-RESOLVE
   * substitutes each unique bankAccountUniqueId into the template once
   * per bank account to issue the live balance fetch.
   *
   * <p>Absent (`undefined`) when SCRAPE could not derive a template
   * (no per-card POST observed). Downstream consumers default-deny.
   */
  readonly balanceFetchTemplate?: IBalanceFetchTemplate;
}

export type { IScrapeState };
