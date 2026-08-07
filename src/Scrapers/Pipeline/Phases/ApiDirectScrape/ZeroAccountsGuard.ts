/**
 * Default fail-closed scrape guard for the hard-model ApiDirectScrape phase —
 * a pure predicate consumed by the POST stage via {@link runResultGuard}.
 *
 * <p>Why this exists: a hard-model bank resolves its accounts from the first
 * post-login data call. When that call is rejected — an HTTP non-200 (a dead
 * session, e.g. Max's 403) or an HTTP-200 bank error envelope (e.g. Yahav's
 * BaNCS 93194) — the extractor finds no account, so the driver iterates zero
 * accounts, fetches no transactions, and the run completes as a SILENT
 * `success([])`: zero transactions, no error. This guard converts that exact
 * shape into a LOUD, typed failure so an invalid session surfaces instead of
 * looking like an empty account.
 *
 * <p>`accountCount === 0` is a universally invalid post-login outcome: a
 * logged-in customer always owns at least one account/card. It is therefore
 * the phase-wide default (applied when a shape declares no `resultGuard`);
 * a shape with its own guard (PayBox's degraded-token guard) keeps it.
 * PII-safe: the message carries no identifiers.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IApiDirectScrapeGuardSummary } from './IApiDirectScrapeShape.js';

/**
 * PII-free operator message: what was OBSERVED (zero accounts) plus every
 * cause worth checking, ranked. Deliberately does NOT assert an authorization
 * failure — `accountCount === 0` cannot prove one. A parser or schema
 * regression, or a genuinely empty response, produces the same count, so
 * naming authorization as the diagnosis would misdirect incident response.
 * For the same reason it prescribes no remedy: renewing the session is a fix
 * for one of the four candidates, and suggesting it up front invites an
 * operator to skip the other three. Naming the rejected-header case matters
 * too: a wrong request header (e.g. a site/tenant identifier adopted from the
 * wrong origin) is rejected by some gateways with an opaque 5xx
 * indistinguishable from a dead session. No identifiers, no figures.
 */
const ZERO_ACCOUNTS_MSG =
  'Hard-model scrape resolved zero accounts — a logged-in customer always has ' +
  'at least one. Check, in order: the response status and envelope (a bank ' +
  'error body or a non-200), session validity, a required request header that ' +
  'may have been rejected, and the accounts parser (a schema change can yield ' +
  'zero without any error).';

/**
 * Fail-closed guard: rejects a scrape that resolved no accounts.
 * @param summary - PII-free scrape summary from the POST stage.
 * @returns Failure when zero accounts were resolved; otherwise a pass-through.
 */
export function zeroAccountsGuard(summary: IApiDirectScrapeGuardSummary): Procedure<void> {
  if (summary.accountCount === 0) return fail(ScraperErrorTypes.Generic, ZERO_ACCOUNTS_MSG);
  return succeed(undefined);
}

export default zeroAccountsGuard;
