/**
 * PiiRedactor — redactUrlFull path-segment redaction. The main PiiRedactor
 * suite is at its 600-line cap, so the URL-path rule lives here: a path
 * segment carrying an account id — numeric or an opaque prefixed id like
 * Discount's Titan `SYN-DC-0001` — is masked to a last-4 hint, while a plain
 * route segment survives.
 */

import { redactUrlFull } from '../../../../Scrapers/Pipeline/Types/PiiRedactor.js';

describe('PiiRedactor — redactUrlFull path segments', () => {
  it('masks an all-digit account id segment', () => {
    const out = redactUrlFull('https://x.example/api/lastTransactions/8878787823/Date');
    expect(out).not.toContain('8878787823');
    expect(out).toContain('lastTransactions/***7823/Date');
  });

  it('masks an opaque prefixed account id (Discount Titan account path)', () => {
    const out = redactUrlFull(
      'https://start.telebank.co.il/Titan/gatewayAPI/accountDetails/infoAndBalance/SYN-DC-0001',
    );
    expect(out).not.toContain('SYN-DC-0001');
    expect(out).toContain('infoAndBalance/***0001');
  });

  it('leaves a route segment with only a short digit run intact', () => {
    const out = redactUrlFull('https://x.example/apollo/retail3/MY_ACCOUNT');
    expect(out).toContain('retail3/MY_ACCOUNT');
  });

  it('leaves a route segment with no digits intact', () => {
    const out = redactUrlFull('https://x.example/api/healthcheck?v=V4');
    expect(out).toBe('https://x.example/api/healthcheck?v=V4');
  });
});
