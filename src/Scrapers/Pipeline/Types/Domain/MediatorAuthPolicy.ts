/**
 * IMediatorAuthPolicy — the ApiMediator's slice of a bank's auth-mode policy
 * (pure DTO leaf).
 *
 * Lives in `Types/Domain` so the config-driven auth policy can extend it
 * without importing the ApiMediator cluster.
 */

/** The mediator's slice of the bank's auth-mode policy. */
interface IMediatorAuthPolicy {
  /** The session rides an Authorization header, so a re-mint must yield one. */
  readonly installHeader: boolean;
  /** Re-mint the session and retry once when a call is rejected as unauthorised. */
  readonly rearmOnReject: boolean;
  /**
   * A rejected session is re-granted once and the whole scrape re-run, rather
   * than one call retried (absent = false).
   */
  readonly wholeScrapeRecovery?: boolean;
}

export type { IMediatorAuthPolicy };
