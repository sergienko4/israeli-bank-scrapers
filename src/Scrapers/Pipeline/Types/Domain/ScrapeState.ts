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
  /**
   * Captured balance-bearing response bodies snapshotted by SCRAPE.post —
   * v6 carried-pool channel.
   *
   * <p>The browser network pool is read during SCRAPE.post (where the
   * mediator is present) and the response bodies are carried on scrape
   * state. BALANCE-RESOLVE.pre runs after the mediator/pool may already be
   * unavailable, but the scrape slice survives — so the captured-pool seed
   * ({@link readCapturedBalanceResponses}) reads these carried bodies
   * instead of the absent live pool. Without this channel an account bank
   * whose live re-fetch is quarantined has no BULK_KEY fallback and
   * universal-misses.
   *
   * <p>Carried as opaque bodies (`unknown[]`, no Mediator type) to keep the
   * Types layer free of a Mediator import. Absent (`undefined`) when SCRAPE
   * had no mediator / an empty pool.
   */
  readonly balanceResponseBodies?: readonly unknown[];
  /**
   * True when at least one account's balance fetch failed and fell back
   * to the shape's `fallbackOnFail` default instead of a live value.
   *
   * <p>Surfaces a degraded warm-session signal that a per-account
   * `balance === fallback` value cannot: a `fallbackOnFail: 0` shape
   * yields `balance === 0` whether `/sync` returned a real zero (healthy
   * empty wallet) OR fell back from a rejected call (degraded token).
   * A shape's `resultGuard` keys on this OUTCOME, never on the value, to
   * distinguish the two. Absent (`undefined`) ⇒ no balance step ran or
   * none fell back (treated as not-degraded; default-deny stays loud
   * only when this is explicitly `true`).
   */
  readonly balanceDegraded?: boolean;
}

export type { IScrapeState };
