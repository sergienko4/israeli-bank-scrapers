/**
 * Credential reader for the local Hapoalim runner.
 *
 * <p>The real-E2E harness passes the password exactly as supplied, so a
 * password with leading or trailing spaces must survive. A user code is an
 * identifier where surrounding whitespace is accidental, so it is trimmed.
 */

import ScraperError from '../../../Scrapers/Base/ScraperError.js';

/** A read-only environment source; defaults to `process.env` at the call site. */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * Read one required environment value.
 * @param name - Variable name.
 * @param isTrimmed - Trim surrounding whitespace (user code) or preserve it (password).
 * @param env - Environment source; defaults to `process.env`.
 * @returns The value.
 * @throws ScraperError when the value is absent or empty.
 */
function readRequiredEnv(name: string, isTrimmed: boolean, env: Env = process.env): string {
  const raw = env[name] ?? '';
  const value = isTrimmed ? raw.trim() : raw;
  if (value.length === 0) {
    throw new ScraperError(`${name} is not set — fill it in .env`);
  }
  return value;
}

export default readRequiredEnv;
