/**
 * Unit tests for Strategy/Fetch/UrlRule — the exact allow-list a redirect
 * target must match: https only, no userinfo, no fragment, exact origin,
 * case-insensitive exact path, and the query rules. Pure — no transport.
 */

import { matchesAnyUrlRule } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/UrlRule.js';
import type { IUrlRule } from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';

const ORIGIN = 'https://mto.bank.example';
const PATH = '/Online/Default.aspx';

const LOOSE: IUrlRule = { origin: ORIGIN, paths: [PATH], query: { language: 'he-IL' } };
const EXACT: IUrlRule = { ...LOOSE, exactQuery: true };
const BARE: IUrlRule = { origin: ORIGIN, paths: [PATH], exactQuery: true };

/**
 * Match one URL string against a rule list.
 * @param url - Absolute target URL.
 * @param rules - Allowed rules.
 * @returns Whether the target matches one rule.
 */
function allowed(url: string, rules: readonly IUrlRule[]): boolean {
  const target = new URL(url);
  return matchesAnyUrlRule(target, rules);
}

describe('matchesAnyUrlRule', () => {
  it.each([
    ['exact origin, path and query', `${ORIGIN}${PATH}?language=he-IL`, [EXACT]],
    ['a path in another case', `${ORIGIN}/online/default.ASPX?language=he-IL`, [EXACT]],
    ['an extra key without exactQuery', `${ORIGIN}${PATH}?language=he-IL&x=1`, [LOOSE]],
    ['no query under a bare exact rule', `${ORIGIN}${PATH}`, [BARE]],
    ['the second of two rules', `${ORIGIN}${PATH}`, [EXACT, BARE]],
  ])('allows %s', (_label, url, rules) => {
    const isAllowed = allowed(url, rules);
    expect(isAllowed).toBe(true);
  });

  it.each([
    ['a foreign origin', `https://evil.example${PATH}?language=he-IL`],
    ['a sibling host', `https://www.bank.example${PATH}?language=he-IL`],
    ['another port', `${ORIGIN}:8443${PATH}?language=he-IL`],
    ['http', `http://mto.bank.example${PATH}?language=he-IL`],
    ['userinfo', `https://user:pw@mto.bank.example${PATH}?language=he-IL`],
    ['a fragment', `${ORIGIN}${PATH}?language=he-IL#top`],
    ['an empty fragment', `${ORIGIN}${PATH}?language=he-IL#`],
    ['another path', `${ORIGIN}/Online/DefaultX.aspx?language=he-IL`],
    ['an extra key', `${ORIGIN}${PATH}?language=he-IL&x=1`],
    ['a duplicate key', `${ORIGIN}${PATH}?language=he-IL&language=he-IL`],
    ['a wrong value', `${ORIGIN}${PATH}?language=en-US`],
    ['a missing key', `${ORIGIN}${PATH}`],
  ])('refuses %s', (_label, url) => {
    const isAllowed = allowed(url, [EXACT]);
    expect(isAllowed).toBe(false);
  });

  it('refuses a required key that appears twice even without exactQuery', () => {
    const isAllowed = allowed(`${ORIGIN}${PATH}?language=he-IL&language=en-US`, [LOOSE]);
    expect(isAllowed).toBe(false);
  });

  it('refuses any query key under a bare exact rule', () => {
    const isAllowed = allowed(`${ORIGIN}${PATH}?x=1`, [BARE]);
    expect(isAllowed).toBe(false);
  });

  it('refuses everything with no rules', () => {
    const isAllowed = allowed(`${ORIGIN}${PATH}`, []);
    expect(isAllowed).toBe(false);
  });
});

describe('matchesAnyUrlRule — anyPathExcept', () => {
  const denyRule: IUrlRule = { origin: ORIGIN, anyPathExcept: ['logout', 'changepass'] };

  it.each([
    ['any path with any query', `${ORIGIN}/wps/portal/home?rid=1&x=2`],
    ['the bare origin', `${ORIGIN}/`],
    ['a safely encoded path', `${ORIGIN}/wps/%70ortal/home`],
  ])('allows %s', (_label, url) => {
    const isAllowed = allowed(url, [denyRule]);
    expect(isAllowed).toBe(true);
  });

  it.each([
    ['a denied text', `${ORIGIN}/wps/logout`],
    ['a denied text in another case', `${ORIGIN}/wps/ChangePass.do`],
    ['a denied text inside a segment', `${ORIGIN}/a/doLOGOUTnow`],
    ['an encoded denied text', `${ORIGIN}/wps/lo%67out`],
    ['an encoded slash before denied text', `${ORIGIN}/wps%2FChangePass.do`],
    ['a malformed percent escape', `${ORIGIN}/wps/%ZZ`],
    ['a malformed UTF-8 escape', `${ORIGIN}/wps/%E0%A4%A`],
    ['a foreign origin', 'https://evil.example/wps/portal/home'],
    ['userinfo', 'https://u:p@mto.bank.example/wps/portal/home'],
    ['http', 'http://mto.bank.example/wps/portal/home'],
    ['a fragment', `${ORIGIN}/wps/portal/home#top`],
  ])('refuses %s', (_label, url) => {
    const isAllowed = allowed(url, [denyRule]);
    expect(isAllowed).toBe(false);
  });

  it('matches a deny text given in upper case', () => {
    const rule: IUrlRule = { origin: ORIGIN, anyPathExcept: ['RECOVERY'] };
    const isAllowed = allowed(`${ORIGIN}/auth/recovery`, [rule]);
    expect(isAllowed).toBe(false);
  });
});
