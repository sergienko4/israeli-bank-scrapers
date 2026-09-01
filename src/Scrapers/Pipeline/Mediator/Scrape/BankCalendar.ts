/**
 * Bank calendar — the single zone every date decision in the Scrape cluster
 * resolves in.
 *
 * Israeli providers state dates in their own calendar and most of them state a
 * *day*, not an instant: `29/06/2026` carries no time and no offset. Turning
 * that into an instant requires choosing a zone, and until issue #545 the
 * choice was made implicitly — by whatever zone the Node process happened to
 * sit in.
 *
 * <p>That was worse than machine-dependent. `BaseScraper.initialize()`
 * (`BaseScraper.ts:109`) calls `moment.tz.setDefault(...)` on the same moment
 * singleton the Pipeline reads, so running a Legacy scraper first changed the
 * value the Pipeline emitted for identical input — the same account could
 * produce two different `ITransaction.date` values in one process depending on
 * scrape order.
 *
 * <p>Naming the zone here removes both variables. It also makes a sentence we
 * can finally write on the public field true: a date-only provider value
 * denotes midnight in the bank's own calendar. Israeli hosts see no change in
 * emitted values; every other host stops disagreeing with them.
 *
 * <p>This is deliberately a *normalisation*, not a claim of truth. The provider
 * did not tell us a time. We pick the only zone the data can reasonably be read
 * in, and say so, rather than letting the deployment pick silently.
 *
 * @see docs/architecture/bank-calendar.md
 */

import moment from 'moment-timezone';

import type { Brand } from '../../Types/Brand.js';
import { ISRAEL_TIMEZONE } from '../Browser/BrowserConfig.js';

/**
 * Zone every bank date is read in.
 *
 * Aliased rather than redeclared so the Pipeline cannot drift from the zone the
 * browser context is pinned to — a page rendering in one calendar while its
 * rows are parsed in another is the bug this module exists to prevent.
 */
export const BANK_CALENDAR_TIMEZONE = ISRAEL_TIMEZONE;

/** Calendar-day label all day-level comparisons reduce to. */
export const BANK_DAY_FORMAT = 'YYYY-MM-DD';

/**
 * A calendar day in the bank's own calendar, as `YYYY-MM-DD`.
 *
 * Nominal so a day label cannot be confused with the ISO *instant* it was
 * derived from — the two look alike at a glance and mixing them is exactly the
 * defect this module exists to prevent. Day labels in this form also sort
 * lexicographically, which is why the window comparisons need no date maths.
 */
export type BankDay = Brand<string, 'BankDay'>;

/**
 * Parse a raw provider value in the bank's calendar.
 *
 * Date-only inputs land on midnight of that day in the bank zone; naive
 * datetimes keep their stated wall-clock reading wherever that reading exists.
 * A wall time inside a DST spring-forward gap has no instant, and moment
 * normalises it forward — `2026-03-27T02:30` reads as 03:30 in Israel. No
 * provider format in `KNOWN_DATE_FORMATS` carries a time in that range in
 * practice, and the old ambient behaviour normalised identically; the note is
 * here so the guarantee is not read as stronger than it is.
 *
 * <p>Neither path consults the ambient default.
 *
 * @param value - Raw value as the provider wrote it.
 * @param formats - Accepted input formats.
 * @param strict - Whether the format must match exactly.
 * @returns Parsed moment fixed to the bank zone; may be invalid.
 */
export function parseInBankZone(
  value: string,
  formats: string | string[],
  strict = false,
): moment.Moment {
  return moment.tz(value, formats, strict, BANK_CALENDAR_TIMEZONE);
}

/**
 * Read an already-resolved instant in the bank's calendar.
 *
 * @param value - ISO-8601 instant, or a `Date`.
 * @param strict - Whether a string must match ISO-8601 exactly.
 * @returns Moment fixed to the bank zone; may be invalid.
 */
export function bankMomentOfInstant(value: string | Date, strict = false): moment.Moment {
  const parsed = value instanceof Date ? moment(value) : moment(value, moment.ISO_8601, strict);
  return parsed.tz(BANK_CALENDAR_TIMEZONE);
}

/**
 * Calendar day an instant falls on in the bank's calendar.
 *
 * Answers `false` rather than a day when the input cannot be read.
 * `moment(...).format()` reports an unreadable value as the *string*
 * `'Invalid date'`, which is day-shaped enough to survive a `string` return
 * and then sort after every real `YYYY-MM-DD` label in the lexicographic
 * comparisons this module exists to enable. `false` is the same "no usable
 * value" sentinel the surrounding Scrape code already uses.
 *
 * @param value - ISO-8601 instant, or a `Date`.
 * @returns Day label, or `false` when the input cannot be read.
 */
export function bankDayOfInstant(value: string | Date): BankDay | false {
  const inZone = bankMomentOfInstant(value);
  if (!inZone.isValid()) return false;
  return inZone.format(BANK_DAY_FORMAT) as BankDay;
}
