import { ScraperError } from './ScraperError';

/** Thrown for login or token failures (wrong credentials, expired/missing auth token). */
export class ScraperAuthenticationError extends ScraperError {
  /**
   * Creates an authentication error for the given bank.
   *
   * @param bankId - identifier of the bank where authentication failed
   * @param message - description of the authentication failure
   */
  constructor(bankId: string, message: string) {
    super('AUTH_FAILED', message, { bankId });
  }
}
export default ScraperAuthenticationError;
