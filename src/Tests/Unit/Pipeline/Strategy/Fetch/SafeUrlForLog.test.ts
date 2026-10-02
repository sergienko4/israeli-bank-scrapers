/**
 * Unit tests for Strategy/Fetch/SafeUrlForLog — the one sanitizer for URLs
 * and for failure text that quotes a request back.
 */

import {
  safeErrorText,
  safeUrlForLog,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/SafeUrlForLog.js';
import { ECHO_QUERY, leakedSecretsIn, urlEchoesOf } from '../../../../Helpers/UrlEchoFixtures.js';

const BASE = 'https://api.example/x';
const REQUEST_URL = `${BASE}${ECHO_QUERY}`;
const ECHOES = urlEchoesOf(BASE);

describe('safeUrlForLog', () => {
  it('keeps origin + path and drops query, fragment and credentials', () => {
    const safe = safeUrlForLog('https://u:p@api.example/x?did=1#frag');
    expect(safe).toBe('https://api.example/x');
  });

  it('names an unparseable URL without echoing it', () => {
    const safe = safeUrlForLog('not a url?did=SECRET');
    expect(safe).toBe('<unparseable>');
  });
});

describe('safeErrorText — oracle: no echo of the request query survives', () => {
  it.each(ECHOES)('$label leaks no secret', ({ text }) => {
    const safe = safeErrorText(text, REQUEST_URL);
    const leaked = leakedSecretsIn(safe);
    expect(leaked).toEqual([]);
  });

  it.each(ECHOES)('$label keeps no query string', ({ text }) => {
    const safe = safeErrorText(text, REQUEST_URL);
    expect(safe).not.toContain(ECHO_QUERY);
  });
});

describe('safeErrorText — keeps the diagnosis readable', () => {
  it('leaves text that quotes nothing untouched', () => {
    const safe = safeErrorText('connect ECONNREFUSED 127.0.0.1:443', REQUEST_URL);
    expect(safe).toBe('connect ECONNREFUSED 127.0.0.1:443');
  });

  it('reduces any quoted URL to origin + path', () => {
    const safe = safeErrorText('redirected to https://idp.example/login?next=abc', REQUEST_URL);
    expect(safe).toBe('redirected to https://idp.example/login');
  });

  it('keeps short query values, which are flags rather than secrets', () => {
    const safe = safeErrorText('app version rejected', REQUEST_URL);
    expect(safe).toBe('app version rejected');
  });

  it('marks where a lone secret value was cut', () => {
    const safe = safeErrorText('unknown device SECRET-DEVICE-ID', REQUEST_URL);
    expect(safe).toBe('unknown device <redacted>');
  });

  it('cuts a value that itself contains "=" whole', () => {
    const url = `${BASE}?token=abc=def=ghi123`;
    const safe = safeErrorText('bad token abc=def=ghi123', url);
    expect(safe).toBe('bad token <redacted>');
  });

  it('survives a malformed percent-encoding in the request query', () => {
    const url = `${BASE}?k=%E0%A4%A-raw-value`;
    const safe = safeErrorText('rejected %E0%A4%A-raw-value', url);
    expect(safe).toBe('rejected <redacted>');
  });

  it('leaves text alone for a request with no query', () => {
    const safe = safeErrorText('500 internal error', BASE);
    expect(safe).toBe('500 internal error');
  });
});
