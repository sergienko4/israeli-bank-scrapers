import { ScraperError } from './ScraperError';

/** Thrown for login or token failures (wrong credentials, expired/missing auth token). */
export class ScraperAuthenticationError extends ScraperError {
  constructor(bankId: string, message: string) {
    super('AUTH_FAILED', message, { bankId });
  }
}
export default ScraperAuthenticationError;
