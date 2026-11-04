/**
 * Header-text rules — an RFC 6265 cookie name is a token, so a name with a
 * space, tab or separator can never travel as `name=value` in a Cookie header.
 */

import { isSendableCookie } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/HeaderText.js';

/** Cookie names that are RFC 9110 tokens. */
const VALID_NAMES = ['sid', '__cf_bm', 'a', "X-Trace_ID.v2!#$%&'*+^`|~"] as const;

/** Cookie names with at least one character outside the token grammar. */
const INVALID_NAMES = [
  '',
  'sid other',
  'sid\tother',
  'sid(1)',
  'sid,1',
  'sid/1',
  'sid"1',
  'sid:1',
  'sid=1',
] as const;

describe('HeaderText/isSendableCookie', () => {
  it.each(VALID_NAMES)('accepts the token name %s', name => {
    const isSendable = isSendableCookie(name, 'value');
    expect(isSendable).toBe(true);
  });

  it.each(INVALID_NAMES)('refuses the invalid name %j', name => {
    const isSendable = isSendableCookie(name, 'value');
    expect(isSendable).toBe(false);
  });

  it('refuses a value that cannot travel in a Cookie header', () => {
    const hasNewline = isSendableCookie('sid', 'x\ny');
    const hasSemicolon = isSendableCookie('sid', '1; admin=1');
    const hasNonLatin = isSendableCookie('sid', '\u05e9');
    expect(hasNewline).toBe(false);
    expect(hasSemicolon).toBe(false);
    expect(hasNonLatin).toBe(false);
  });
});
