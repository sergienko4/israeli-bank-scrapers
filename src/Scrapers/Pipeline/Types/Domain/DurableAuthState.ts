/**
 * Durable auth artifact captured outside the browser LOGIN phase.
 *
 * API-direct banks (OneZero, Pepper, PayBox) authenticate over HTTP and never
 * build an `ILoginState` — that contract carries a live `Page | Frame`. They
 * still mint a long-lived handle the caller must store to skip the next SMS,
 * so it travels in its own slot and is surfaced through the same public
 * `result.persistentOtpToken` field the browser scrapers use.
 */

/** Long-lived re-login artifact produced by an API-direct login chain. */
interface IDurableAuthState {
  /**
   * The token the caller should persist and pass back as
   * `credentials.otpLongTermToken` on the next run.
   */
  readonly persistentOtpToken: string;
}

export type { IDurableAuthState };
