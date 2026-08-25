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

/**
 * Malformed *elements*, as opposed to a malformed container.
 *
 * `Array.isArray` proves only that the summary is a list; it says nothing
 * about what sits in each slot. A JSON null or a bare primitive there used to
 * fault the field read and take down an otherwise good scrape — the one way
 * this reader could still throw despite promising never to.
 */
describe('ilsCycleDebit — tolerates malformed rows inside the summary', () => {
  /** Element shapes that are not records, cast at the single unsafe boundary. */
  const badRows: readonly unknown[] = [null, undefined, 'x', 7, true, []];

  it.each(badRows)('returns 0 rather than throwing for the element %p', row => {
    const card = { CycleSummary: [row] } as unknown as { CycleSummary?: null };
    const debit = ilsCycleDebit(card);
    expect(debit).toBe(0);
  });

  it('still finds the ILS row when a malformed element precedes it', () => {
    const rows = [null, { Currency: 376, TotalDebitSum: 42.5 }];
    const card = { CycleSummary: rows } as unknown as { CycleSummary?: null };
    const debit = ilsCycleDebit(card);
    expect(debit).toBe(42.5);
  });

  it('returns 0 when every element is malformed', () => {
    const card = { CycleSummary: [null, undefined, 3] } as unknown as { CycleSummary?: null };
    const debit = ilsCycleDebit(card);
    expect(debit).toBe(0);
  });
});
