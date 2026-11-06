/**
 * SafeUrlForLog — the one URL sanitizer every fetch transport logs and reports
 * errors with. It must drop the query outright (session ids / tokens live
 * there) and mask any account-bearing path segment (a bank that names an
 * account in its read URL), while keeping the route path so logs stay useful.
 */

import {
  safeUrlForLog,
  scrubUrlFromText,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/SafeUrlForLog.js';

/** The Discount Titan balance read: the account id rides the final segment. */
const TITAN_BALANCE =
  'https://start.telebank.co.il/Titan/gatewayAPI/accountDetails/infoAndBalance/SYN-DC-0001';

/** A URL carrying a session id in its query. */
const WITH_QUERY = 'https://www.bank.example/start?sid=L0CATION-SECRET';

describe('safeUrlForLog', () => {
  it('drops the query string and its session id', () => {
    const out = safeUrlForLog(WITH_QUERY);
    expect(out).toBe('https://www.bank.example/start');
  });

  it('masks an account id in the path to a last-4 hint', () => {
    const out = safeUrlForLog(TITAN_BALANCE);
    expect(out).not.toContain('SYN-DC-0001');
    expect(out).toBe(
      'https://start.telebank.co.il/Titan/gatewayAPI/accountDetails/infoAndBalance/***0001',
    );
  });

  it('keeps a route path with no account id', () => {
    const out = safeUrlForLog('https://mto.bank.example/Online/Default.aspx');
    expect(out).toBe('https://mto.bank.example/Online/Default.aspx');
  });

  it('echoes no raw URL when the input cannot be parsed', () => {
    const out = safeUrlForLog('not a url');
    expect(out).toBe('<unparseable>');
  });
});

describe('scrubUrlFromText', () => {
  it('replaces a quoted query string with nothing', () => {
    const text = `engine error at ${WITH_QUERY} (refused)`;
    const out = scrubUrlFromText(text, WITH_QUERY);
    expect(out).not.toContain('L0CATION-SECRET');
    expect(out).toContain('https://www.bank.example/start');
  });
});
