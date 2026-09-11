/**
 * Unit tests — UrlDateRangeInspect (Hapoalim preview-window fix support).
 *
 * <p>Covers all branches of {@link urlHasWkDateRange} and
 * {@link readCapturedFromDate} plus the private `parseWkDateValue`
 * shape branches exercised indirectly through `readCapturedFromDate`:
 * <ul>
 *   <li>Malformed URL → false</li>
 *   <li>URL with no WK keys → no probe / no date</li>
 *   <li>URL with WK fromKey null value → false (defence-in-depth path)</li>
 *   <li>YYYYMMDD parseable / unparseable (e.g. month=13)</li>
 *   <li>ISO YYYY-MM-DD parseable / unparseable</li>
 *   <li>Raw value matches neither shape → false</li>
 * </ul>
 */
import { bankDayOfInstant } from '../../../../Scrapers/Pipeline/Mediator/Scrape/BankCalendar.js';
import {
  readCapturedFromDate,
  urlHasWkDateRange,
} from '../../../../Scrapers/Pipeline/Mediator/Scrape/UrlDateRangeInspect.js';
import { underZone } from '../../../Helpers/AmbientZone.js';

describe('urlHasWkDateRange', () => {
  it('returns hasWkDateRange=false on malformed URL', () => {
    const probe = urlHasWkDateRange('::not-a-url::');
    expect(probe.hasWkDateRange).toBe(false);
  });

  it('returns hasWkDateRange=true when URL has both fromDate + toDate WK aliases', () => {
    const url =
      'https://login.bankhapoalim.co.il/ServerServices/current-account/transactions' +
      '?retrievalStartDate=20260508&retrievalEndDate=20260607';
    const probe = urlHasWkDateRange(url);
    expect(probe.hasWkDateRange).toBe(true);
  });

  it('returns hasWkDateRange=false when URL has no WK aliases', () => {
    const url = 'https://example.com/path?accountId=12345&lang=he';
    const probe = urlHasWkDateRange(url);
    expect(probe.hasWkDateRange).toBe(false);
  });

  it('returns hasWkDateRange=false when URL has only fromDate without toDate', () => {
    const url = 'https://example.com/path?retrievalStartDate=20260508';
    const probe = urlHasWkDateRange(url);
    expect(probe.hasWkDateRange).toBe(false);
  });
});

describe('readCapturedFromDate', () => {
  it('parses a date-only provider label in the bank calendar', () => {
    const url = 'https://example.com/path?fromDate=2026-05-08&toDate=2026-06-07';
    /**
     * Read the captured bound under an alternate Moment default.
     * @returns Parsed bound.
     */
    const read = (): ReturnType<typeof readCapturedFromDate> => readCapturedFromDate(url);
    const result = underZone('Pacific/Kiritimati', read);
    const bankDay = result === false ? false : bankDayOfInstant(result);
    expect(bankDay).toBe('2026-05-08');
  });

  it('returns false on malformed URL', () => {
    const result = readCapturedFromDate('::not-a-url::');
    expect(result).toBe(false);
  });

  it('returns false when URL has no WK fromDate alias', () => {
    const url = 'https://example.com/path?accountId=12345';
    const result = readCapturedFromDate(url);
    expect(result).toBe(false);
  });

  it('parses YYYYMMDD WK fromDate value to a Date', () => {
    const url = 'https://example.com/path?retrievalStartDate=20260508&retrievalEndDate=20260607';
    const result = readCapturedFromDate(url);
    expect(result).toBeInstanceOf(Date);
    const bankDay = result === false ? false : bankDayOfInstant(result);
    expect(bankDay).toBe('2026-05-08');
  });

  it('parses ISO YYYY-MM-DD WK fromDate value to a Date', () => {
    const url = 'https://example.com/path?fromDate=2026-05-08&toDate=2026-06-07';
    const result = readCapturedFromDate(url);
    expect(result).toBeInstanceOf(Date);
    const parsedDate = result as Date;
    const yyyy = parsedDate.getUTCFullYear();
    const mm = parsedDate.getUTCMonth();
    expect(yyyy).toBe(2026);
    expect(mm).toBe(4);
  });

  it('returns false on invalid YYYYMMDD shape (month=13)', () => {
    const url = 'https://example.com/path?retrievalStartDate=20261305&retrievalEndDate=20261306';
    const result = readCapturedFromDate(url);
    expect(result).toBe(false);
  });

  it('returns false when raw value matches neither YYYYMMDD nor ISO', () => {
    const url = 'https://example.com/path?retrievalStartDate=garbage&retrievalEndDate=20260607';
    const result = readCapturedFromDate(url);
    expect(result).toBe(false);
  });

  it('returns false when ISO value is invalid (month=13)', () => {
    const url = 'https://example.com/path?fromDate=2026-13-08&toDate=2026-06-07';
    const result = readCapturedFromDate(url);
    expect(result).toBe(false);
  });
});
