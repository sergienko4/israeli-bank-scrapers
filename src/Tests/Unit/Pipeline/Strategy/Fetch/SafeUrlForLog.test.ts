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

describe('safeUrlForLog — explicit account ids', () => {
  /** A valid Titan id with no four-digit run — the path heuristic cannot see it. */
  const opalId = 'ACCT_1-a';

  /** The balance read carrying {@link opalId} in its final segment. */
  const opalBalance = `https://start.telebank.co.il/Titan/gatewayAPI/accountDetails/infoAndBalance/${opalId}`;

  it('masks an explicit id that carries no four-digit run', () => {
    const out = safeUrlForLog(opalBalance, [opalId]);
    expect(out).not.toContain(opalId);
    expect(out).toBe(
      'https://start.telebank.co.il/Titan/gatewayAPI/accountDetails/infoAndBalance/[REDACTED]',
    );
  });

  it('masks a long explicit id that carries no digits', () => {
    const id = 'a'.repeat(64);
    const url = `https://start.telebank.co.il/Titan/gatewayAPI/accountDetails/infoAndBalance/${id}`;
    const out = safeUrlForLog(url, [id]);
    expect(out).not.toContain(id);
    expect(out).toContain('***aaaa');
  });

  it('still masks a digit-carrying id when passed explicitly', () => {
    const out = safeUrlForLog(TITAN_BALANCE, ['SYN-DC-0001']);
    expect(out).not.toContain('SYN-DC-0001');
    expect(out).toContain('***0001');
  });
});

describe('scrubUrlFromText', () => {
  it('replaces a quoted query string with nothing', () => {
    const text = `engine error at ${WITH_QUERY} (refused)`;
    const out = scrubUrlFromText(text, WITH_QUERY);
    expect(out).not.toContain('L0CATION-SECRET');
    expect(out).toContain('https://www.bank.example/start');
  });

  it('masks an explicit account id quoted inside free text', () => {
    const id = 'ACCT_1-a';
    const url = `https://start.telebank.co.il/Titan/gatewayAPI/accountDetails/infoAndBalance/${id}`;
    const out = scrubUrlFromText(`request failed: ${url}`, url, [id]);
    expect(out).not.toContain(id);
    expect(out).toContain('infoAndBalance/[REDACTED]');
  });
});
