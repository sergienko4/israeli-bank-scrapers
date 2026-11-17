/**
 * Simple cookie jar — deletion, last-write-wins and the 300-cookie cap.
 */

import { createSimpleCookieJar } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/CookieJar.js';

/**
 * Build numbered Set-Cookie lines.
 * @param count - Number of cookies.
 * @returns Lines named `cookie-0` upward.
 */
function cookieLines(count: number): readonly string[] {
  return Array.from({ length: count }, (_value, index) => `cookie-${String(index)}=1`);
}

describe('CookieJar/size cap', () => {
  it('keeps the newest 300 cookies and evicts the oldest', () => {
    const jar = createSimpleCookieJar();
    const lines = cookieLines(301);
    const size = jar.add(lines);
    const header = jar.header();
    expect(size).toBe(300);
    expect(header).not.toContain('cookie-0=');
    expect(header).toContain('cookie-300=');
  });

  it('replaces an existing name at the cap without evicting another', () => {
    const jar = createSimpleCookieJar();
    const lines = cookieLines(300);
    jar.add(lines);
    const size = jar.add(['cookie-0=new']);
    const header = jar.header();
    expect(size).toBe(300);
    expect(header).toContain('cookie-0=new');
    expect(header).toContain('cookie-1=1');
  });
});
