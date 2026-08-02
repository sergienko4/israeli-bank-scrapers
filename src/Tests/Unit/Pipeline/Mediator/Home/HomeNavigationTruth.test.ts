/**
 * T-NAVURL — the comparison that decides whether HOME navigated.
 *
 * <p>Guards the defect that made HOME unfailable: bank configs carry a bare
 * origin while the browser reports the normalized form, so the previous
 * `current !== homepageUrl` was `true` on every run for every bank. Row
 * T-NAVURL-1 is that exact case.
 */

import { hasLeftHomepage } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeNavigationTruth.js';

/** One truth-table row. */
interface INavCase {
  readonly id: string;
  readonly homepageUrl: string;
  readonly currentUrl: string;
  readonly expected: boolean;
  readonly why: string;
}

const CASES: readonly INavCase[] = [
  {
    id: 'T-NAVURL-1',
    homepageUrl: 'https://x.co.il',
    currentUrl: 'https://x.co.il/',
    expected: false,
    why: 'browser-normalized slash — the defect',
  },
  {
    id: 'T-NAVURL-2',
    homepageUrl: 'https://x.co.il',
    currentUrl: 'https://x.co.il',
    expected: false,
    why: 'identical',
  },
  {
    id: 'T-NAVURL-3',
    homepageUrl: 'https://x.co.il',
    currentUrl: 'https://x.co.il/#top',
    expected: false,
    why: 'fragment ignored',
  },
  {
    id: 'T-NAVURL-4',
    homepageUrl: 'https://x.co.il',
    currentUrl: 'https://x.co.il/?a=1',
    expected: true,
    why: 'query stays significant — conservative by design',
  },
  {
    id: 'T-NAVURL-5',
    homepageUrl: 'https://x.co.il',
    currentUrl: 'https://x.co.il/login?ReturnURL=y',
    expected: true,
    why: 'real navigation',
  },
  {
    id: 'T-NAVURL-6',
    homepageUrl: 'https://x.co.il',
    currentUrl: 'https://x.co.il/cards/giftcards',
    expected: true,
    why: 'real navigation',
  },
  {
    id: 'T-NAVURL-7',
    homepageUrl: 'https://x.co.il/he',
    currentUrl: 'https://x.co.il/he/',
    expected: false,
    why: 'base carries a path',
  },
  {
    id: 'T-NAVURL-8',
    homepageUrl: 'https://x.co.il/he',
    currentUrl: 'https://x.co.il/he/login',
    expected: true,
    why: 'navigated under a path base',
  },
  {
    id: 'T-NAVURL-9',
    homepageUrl: 'not-a-url',
    currentUrl: 'https://x.co.il/',
    expected: true,
    why: 'unparseable falls back to strict !==',
  },
  {
    id: 'T-NAVURL-10',
    homepageUrl: 'https://www.cal-online.co.il/',
    currentUrl: 'https://www.cal-online.co.il/',
    expected: false,
    why: 'VisaCal — config already carries the slash',
  },
  {
    id: 'T-NAVURL-11',
    homepageUrl: 'http://x.co.il',
    currentUrl: 'https://x.co.il/',
    expected: true,
    why: 'scheme upgrade is a move',
  },
];

/**
 * Empty strings must not reach `new URL` unguarded.
 * @returns The comparison result, discarded by the assertion.
 */
function probeEmpty(): boolean {
  const didNavigate = hasLeftHomepage('', '');
  return Boolean(didNavigate);
}

describe('HOME navigation truth (T-NAVURL)', () => {
  it.each(CASES)('$id: $why', (navCase: INavCase) => {
    const didNavigate = hasLeftHomepage(navCase.currentUrl, navCase.homepageUrl);
    const didNavigatePlain = Boolean(didNavigate);
    expect({ id: navCase.id, didNavigate: didNavigatePlain }).toEqual({
      id: navCase.id,
      didNavigate: navCase.expected,
    });
  });

  it('T-NAVURL-12: never throws on malformed input', () => {
    expect(probeEmpty).not.toThrow();
  });
});
