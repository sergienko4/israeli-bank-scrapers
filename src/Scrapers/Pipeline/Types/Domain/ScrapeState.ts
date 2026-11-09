import type { ITransactionsAccount } from '../../../../Transactions.js';
import type { WindowCaveat } from '../../../../WindowCoverage.js';

/** Scrape phase result context. */
interface IScrapeState {
  readonly accounts: readonly ITransactionsAccount[];
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
  /**
   * True when at least one account's backfill was spent without covering the
   * requested window: the provider was re-asked for the missing older slice
   * and did not serve it.
   *
   * <p>Records the outcome the transaction list cannot. A truncated window and
   * a quiet account produce the same rows, so only the walk that re-asked can
   * tell them apart — and until this flag existed that answer reached the log
   * and nothing else.
   *
   * <p>Deliberately narrow. It is not set when no ask was possible (a stance
   * that forbids backfill, a page carrying no usable date, the operator
   * kill-switch), because "we never asked" is a different fact from "we asked
   * and could not get more". Absent (`undefined`) ⇒ no walk reported
   * exhaustion; consumers treat only an explicit `true` as a shortfall.
   */
  readonly backfillExhausted?: boolean;
  /**
   * Per-account post-mapping evidence aggregated independently of coverage.
   * Empty means no caveats were recorded; absent means evidence is unavailable.
   */
  readonly observedCaveats?: readonly WindowCaveat[];
}

export type { IScrapeState };
