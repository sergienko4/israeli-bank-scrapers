/**
 * Independent test-side oracle for the forensic run-stamp format
 * `DD-MM-YYYY_HHMMSScc`.
 *
 * Production keeps `formatRunStamp` private to `TraceStamp.ts`; tests compare
 * against this copy so a change to the production formatter cannot silently
 * rewrite both sides of the assertion. Keep the rules here literal: day,
 * month, year, hours, minutes, seconds and centiseconds, each zero-padded to at
 * least two digits.
 */

/**
 * Left-pad a non-negative integer with `'0'` to a minimum width of 2 without
 * truncating wider values (such as a four-digit year).
 * @param value - Non-negative integer to pad.
 * @returns Zero-padded numeric string of at least two characters.
 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Format the date half (`DD-MM-YYYY`) of a run stamp.
 * @param date - Date to format.
 * @returns Zero-padded day, month and four-digit year.
 */
function stampDate(date: Date): string {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear() % 10000;
  return `${pad2(day)}-${pad2(month)}-${pad2(year)}`;
}

/**
 * Format the clock half (`HHMMSS`) of a run stamp.
 * @param date - Date to format.
 * @returns Zero-padded hours, minutes and seconds.
 */
function clockHalf(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  return `${pad2(hours)}${pad2(minutes)}${pad2(seconds)}`;
}

/**
 * Format the centisecond suffix (`cc`) of a run stamp.
 * @param date - Date to format.
 * @returns Zero-padded centiseconds.
 */
function stampCentiseconds(date: Date): string {
  const centiseconds = Math.floor(date.getMilliseconds() / 10);
  return pad2(centiseconds);
}

/**
 * Build a `DD-MM-YYYY_HHMMSScc` timestamp for the given Date instance.
 * @param date - Date to format.
 * @returns Timestamp string.
 */
function formatRunStamp(date: Date): string {
  return `${stampDate(date)}_${clockHalf(date)}${stampCentiseconds(date)}`;
}

export default formatRunStamp;
