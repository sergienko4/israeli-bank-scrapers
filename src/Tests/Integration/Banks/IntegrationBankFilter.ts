/**
 * Per-bank filter for integration test matrix execution.
 *
 * <p>When `INTEGRATION_BANK_FILTER` env var is set, the suite restricts
 * itself to the single bank whose `bankId` matches. Used by the CI
 * matrix-per-bank refactor (see `.github/workflows/pr.yml` `integration`
 * matrix job) to shard the otherwise-serial 7-bank cross-bank tests
 * across 7 parallel runners — wall time drops from ~3-6 min to ~30-60s
 * per shard.
 *
 * <p>Unset env var preserves the default behaviour: every bank in
 * {@link BANK_FIXTURE_EXPECTATIONS} runs in one process — what
 * `npm run test:integration:mode-a` and `npm run test:integration:mode-b`
 * still do locally.
 */

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import type { IBankFixtureExpectations } from './FixtureExpectations.js';

const FILTER_ENV_VAR = 'INTEGRATION_BANK_FILTER';

/**
 * Build the "unknown bankId" error message — extracted so the public
 * function stays under the §19.10 10-line cap. The message lists every
 * known bankId so an operator typo (e.g. `visacal` vs `visaCal`) surfaces
 * immediately with the correct casing.
 *
 * @param banks - Full bank list (source of the known-bankIds list).
 * @param filter - The invalid env-var value the operator supplied.
 * @returns Human-readable error message ending with the known-bankIds list.
 */
function buildUnknownBankMsg(banks: readonly IBankFixtureExpectations[], filter: string): string {
  const known = banks.map(b => b.bankId).join(', ');
  return `${FILTER_ENV_VAR}="${filter}" did not match any bank in BANK_FIXTURE_EXPECTATIONS. Known bankIds: ${known}`;
}

/**
 * Filter the bank fixture list by the optional `INTEGRATION_BANK_FILTER`
 * env var. Returns the input unchanged when the env var is unset or empty.
 *
 * @param banks - Full bank fixture list (typically {@link BANK_FIXTURE_EXPECTATIONS}).
 * @returns Filtered subset matching the env-var bankId, or the full list.
 * @throws {ScraperError} If env var is set but no bank matches — surfaces
 *                  matrix typos (e.g. `visacal` vs `visaCal`) early
 *                  instead of silently running an empty suite.
 */
export default function filterBanksByEnv(
  banks: readonly IBankFixtureExpectations[],
): readonly IBankFixtureExpectations[] {
  const filter = process.env[FILTER_ENV_VAR];
  if (filter === undefined || filter === '') return banks;
  const matched = banks.filter(b => b.bankId === filter);
  if (matched.length === 0) throw new ScraperError(buildUnknownBankMsg(banks, filter));
  return matched;
}
