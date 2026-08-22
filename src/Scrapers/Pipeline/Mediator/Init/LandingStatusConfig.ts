/**
 * Landing-status policy for the INIT navigation.
 *
 * <p>Why this exists. `page.goto(..., { waitUntil: 'commit' })` resolves
 * as soon as the main-resource headers commit, and its return value
 * carries the status. That status used to be discarded, so a bank-served
 * error document passed INIT as healthy and the run failed several
 * phases later with a misleading reason ("no login link", "no password
 * field"). Observed on Discount: the first navigation landed on the
 * bank's own branded 404 while every INIT stage reported OK.
 *
 * <p>Why only 404/410 are terminal. This library's whole premise is
 * getting through WAFs, and a challenge page legitimately commits with
 * 403/429/503 before resolving into the real document — the challenge
 * interceptor detects it from the DOM and solves it later in the run
 * (see `WafChallenge/WafChallengeInternals.ts`, which records Hapoalim's
 * hCaptcha settling 1.5s AFTER HOME.PRE had already scanned the page).
 * Failing INIT on those statuses would break a flow that currently
 * works. 404 and 410 are different in kind: they assert the document
 * does not exist, no challenge is served under them, and no later phase
 * can recover from one.
 */

import type { Brand } from '../../Types/Brand.js';

/** HTTP status of the committed landing document. */
export type LandingStatus = Brand<number, 'LandingStatus'>;

/**
 * Statuses that assert the document does not exist. A landing page
 * answering one of these can never become a working page, so INIT fails
 * immediately and attributably instead of letting a later phase report a
 * misleading symptom.
 *
 * <p>Deliberately excludes 403/429/503 — those are challenge-capable and
 * are owned by the WAF-challenge interceptor.
 */
export const TERMINAL_LANDING_STATUSES: ReadonlySet<number> = new Set([404, 410]);

/**
 * Reported when Playwright surfaces no response for the navigation (for
 * example a same-document navigation). Absence of a status is not
 * evidence of an error, so this value never triggers a failure.
 */
export const NO_LANDING_STATUS = 0 as LandingStatus;
