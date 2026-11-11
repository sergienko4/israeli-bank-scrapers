/**
 * Run-stamp formatting for forensic artefact folders — the
 * `DD-MM-YYYY_HHMMSScc` leaf that names one process's run folder and the
 * `runId` field every log line carries. Split out of TraceConfig.ts so the
 * folder/env module stays under the per-file LOC ceiling.
 *
 * `cc` is centiseconds (milliseconds / 10) for sub-second uniqueness across
 * parallel jest invocations. The stamp reads the machine clock on purpose: a
 * run folder must match the local time an operator reads, and it names a
 * forensic artefact rather than bank-calendar data.
 */

import type { Brand } from './Brand.js';

/** Zero-padded numeric field (minimum width 2; wider values pass through). */
type PaddedDigits = Brand<string, 'TraceTwoDigitPad'>;
/** Run-stamp string `DD-MM-YYYY_HHMMSScc`. */
type RunStampStr = Brand<string, 'RunStampStr'>;

/**
 * Left-pad a non-negative integer with `'0'` to a minimum width of 2 without
 * truncating wider values (such as a four-digit year).
 * @param n - Non-negative integer to pad.
 * @returns Zero-padded numeric string of at least two characters.
 */
function pad2(n: number): PaddedDigits {
  const s = String(n);
  return s.padStart(2, '0') as PaddedDigits;
}

/**
 * Format the date half (`DD-MM-YYYY`) of a run stamp.
 * @param d - Date to format.
 * @returns Zero-padded day, month and four-digit year.
 */
function stampDate(d: Date): string {
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear() % 10000;
  const dd = pad2(day);
  const mm = pad2(month);
  const yyyy = pad2(year);
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Format the clock half (`HHMMSS`) of a run stamp.
 * @param d - Date to format.
 * @returns Zero-padded hours, minutes and seconds.
 */
function clockHalf(d: Date): string {
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();
  const hh = pad2(hours);
  const mi = pad2(minutes);
  const ss = pad2(seconds);
  return `${hh}${mi}${ss}`;
}

/**
 * Format the centisecond suffix (`cc`) of a run stamp.
 * @param d - Date to format.
 * @returns Zero-padded centiseconds.
 */
function stampCentiseconds(d: Date): string {
  const millis = d.getMilliseconds();
  const centiseconds = Math.floor(millis / 10);
  return pad2(centiseconds);
}

/**
 * Build a `DD-MM-YYYY_HHMMSScc` timestamp for the given Date instance.
 * @param d - Date to format.
 * @returns Timestamp string.
 */
function formatRunStamp(d: Date): RunStampStr {
  const clock = clockHalf(d);
  const centiseconds = stampCentiseconds(d);
  const stamp = `${stampDate(d)}_${clock}${centiseconds}`;
  return stamp as RunStampStr;
}

export type { RunStampStr };
export { formatRunStamp };
