/**
 * Max per-card cycle balance reader — unit coverage for `ilsCycleDebit`.
 *
 * The happy path is pinned against the captured `getHomePageData` fixture so
 * the ILS row this reads is the one Max actually sends, not a shape invented
 * here. The remaining cases pin the degrade-to-0 contract: every malformed
 * summary must return the historical sentinel rather than throw or surface
 * NaN, because a wire-shape change must not fail an otherwise good scrape.
 */

import { readFileSync } from 'node:fs';

import { ilsCycleDebit } from '../../../../../Scrapers/Pipeline/Banks/Max/scrape/MaxShapeBalance.js';

const FIXTURE =
  'src/Tests/Unit/Pipeline/CrossValidation/Fixtures/CrossBank/max/getHomePageData.json';

/**
 * Read the captured getHomePageData fixture, stripping its `// URL` header.
 * @returns Parsed fixture body.
 */
function loadFixture(): Record<string, unknown> {
  const raw = readFileSync(FIXTURE, 'utf8');
  const lines = raw.split('\n').filter(l => !l.trim().startsWith('//'));
  const body = lines.join('\n');
  return JSON.parse(body) as Record<string, unknown>;
}

interface IFixtureShape {
  readonly Result: { readonly UserCards: { readonly Cards: readonly object[] } };
}

describe('ilsCycleDebit — captured Max response', () => {
  it('reads the ILS cycle debit off the captured card', () => {
    const fixture = loadFixture() as unknown as IFixtureShape;
    const card = fixture.Result.UserCards.Cards[0];
    const debit = ilsCycleDebit(card);
    expect(debit).toBe(13.84);
  });

  it('ignores non-ILS currency rows', () => {
    const card = {
      CycleSummary: [
        { Currency: 840, TotalDebitSum: 999 },
        { Currency: 376, TotalDebitSum: 42.5 },
      ],
    };
    const debit = ilsCycleDebit(card);
    expect(debit).toBe(42.5);
  });
});

describe('ilsCycleDebit — degrades to the 0 sentinel', () => {
  it('returns 0 when no ILS row is present', () => {
    const debit = ilsCycleDebit({ CycleSummary: [{ Currency: 840, TotalDebitSum: 999 }] });
    expect(debit).toBe(0);
  });

  it('returns 0 when the summary is absent', () => {
    const debit = ilsCycleDebit({});
    expect(debit).toBe(0);
  });

  it('returns 0 when the summary is null', () => {
    const debit = ilsCycleDebit({ CycleSummary: null });
    expect(debit).toBe(0);
  });

  it('returns 0 rather than throwing when the summary is not an array', () => {
    const card = { CycleSummary: '[<1 redacted items>]' } as unknown as {
      CycleSummary?: null;
    };
    const debit = ilsCycleDebit(card);
    expect(debit).toBe(0);
  });

  it('returns 0 when the ILS total is a string rather than a number', () => {
    const card = { CycleSummary: [{ Currency: 376, TotalDebitSum: '13.84' }] } as unknown as {
      CycleSummary?: null;
    };
    const debit = ilsCycleDebit(card);
    expect(debit).toBe(0);
  });

  it('returns 0 when the ILS total is NaN', () => {
    const debit = ilsCycleDebit({ CycleSummary: [{ Currency: 376, TotalDebitSum: NaN }] });
    expect(debit).toBe(0);
  });

  it('preserves a genuine zero debit', () => {
    const debit = ilsCycleDebit({ CycleSummary: [{ Currency: 376, TotalDebitSum: 0 }] });
    expect(debit).toBe(0);
  });
});
