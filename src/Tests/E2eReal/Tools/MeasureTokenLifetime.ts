/**
 * MeasureTokenLifetime — report how long a cached long-term token is valid
 * for, read from its own `iat`/`exp` claims.
 *
 * <p>Exists so a lifetime quoted in the bank docs can be re-measured rather
 * than taken on trust. The token is read but never printed, logged or
 * copied; only the two timestamps and the interval between them are shown.
 *
 * Usage:
 *   ONEZERO_OTP_LONG_TERM=1 npm run measure:token-lifetime -- onezero
 */

import { readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { measureJwtLifetime } from '../JwtLifetime.js';

const EXIT_FAILURE = 1;
const BANK_ARG_INDEX = 2;
const MS_PER_SECOND = 1000;

/**
 * Resolve the cache file for a bank key, mirroring `TokenCache.cachePathFor`.
 * @param bankKey - Bank key whose cache should be measured.
 * @returns Absolute path to the cache file.
 */
function cacheFileFor(bankKey: string): string {
  const base = os.tmpdir();
  return path.join(base, `${bankKey}-token.cache`);
}

/**
 * Format one epoch-seconds timestamp as an ISO-8601 instant.
 * @param seconds - Seconds since the epoch.
 * @returns ISO-8601 string in UTC.
 */
function asIso(seconds: number): string {
  const at = new Date(seconds * MS_PER_SECOND);
  return at.toISOString();
}

/**
 * Measure the cached token for a bank and print the result.
 * @param bankKey - Bank key whose cache should be measured.
 * @returns Nothing; output goes to stdout.
 */
async function reportLifetime(bankKey: string): Promise<void> {
  const file = cacheFileFor(bankKey);
  const raw = await readFile(file, 'utf8');
  const token = raw.trim();
  if (token.length === 0) throw new ScraperError(`no cached token at ${file}`);
  const { iatSec, expSec, days } = measureJwtLifetime(token);
  const span = `iat=${asIso(iatSec)} exp=${asIso(expSec)} lifetime=${String(days)} days`;
  console.log(`${bankKey}: ${span}`);
}

/**
 * Entry point — read the bank key from argv and report its token lifetime.
 * @returns Nothing; exits non-zero on failure.
 */
async function main(): Promise<void> {
  const bankKey = process.argv.at(BANK_ARG_INDEX) ?? '';
  if (bankKey.length === 0) throw new ScraperError('usage: measure:token-lifetime -- <bankKey>');
  await reportLifetime(bankKey);
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(reason);
  process.exit(EXIT_FAILURE);
});
