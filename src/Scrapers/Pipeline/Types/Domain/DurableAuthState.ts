/**
 * Durable auth artifact minted by an API-direct login chain.
 *
 * Banks that authenticate over HTTP (OneZero, Pepper, PayBox) mint a
 * long-lived handle the caller must store to skip the next SMS. It travels
 * in its own context slot and is surfaced through the public
 * `result.persistentOtpToken` field.
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
