import MOVEMENTS_FRAGMENTS_2 from '../../Scrapers/OneZero/OneZeroFragments.js';
import { GET_CUSTOMER, GET_MOVEMENTS } from '../../Scrapers/OneZero/OneZeroQueries.js';

/**
 * Extract all GraphQL fragment type targets from a query string.
 * Matches patterns like: `fragment FooBar on SomeType {`
 * @param query - The GraphQL query string.
 * @returns Array of { fragmentName, typeName } pairs.
 */
function extractFragmentTypes(query: string): { fragmentName: string; typeName: string }[] {
  const regex = /fragment\s+(\w+)\s+on\s+(\w+)/g;
  const results: { fragmentName: string; typeName: string }[] = [];
  let match = regex.exec(query);
  while (match !== null) {
    results.push({ fragmentName: match[1], typeName: match[2] });
    match = regex.exec(query);
  }
  return results;
}

/**
 * Extract all fragment spread references from a query string.
 * Matches patterns like: `...FragmentName`
 * @param query - The GraphQL query string.
 * @returns Array of fragment names referenced via spread.
 */
function extractFragmentSpreads(query: string): string[] {
  const regex = /\.\.\.(\w+)/g;
  const results: string[] = [];
  let match = regex.exec(query);
  while (match !== null) {
    results.push(match[1]);
    match = regex.exec(query);
  }
  return results;
}

describe('OneZero GraphQL Schema Compatibility', () => {
  describe('Fragment type names must not use I-prefix (positive)', () => {
    it('GET_MOVEMENTS query fragments have no I-prefixed types', () => {
      const fragments = extractFragmentTypes(GET_MOVEMENTS);
      expect(fragments.length).toBeGreaterThan(0);
      const iPrefixed = fragments.filter(f => /^I[A-Z]/.test(f.typeName));
      expect(iPrefixed).toEqual([]);
    });

    it('MOVEMENTS_FRAGMENTS_2 fragments have no I-prefixed types', () => {
      const fragments = extractFragmentTypes(MOVEMENTS_FRAGMENTS_2);
      expect(fragments.length).toBeGreaterThan(0);
      const iPrefixed = fragments.filter(f => /^I[A-Z]/.test(f.typeName));
      expect(iPrefixed).toEqual([]);
    });

    it('GET_CUSTOMER query has no I-prefixed inline types', () => {
      const fragments = extractFragmentTypes(GET_CUSTOMER);
      const iPrefixed = fragments.filter(f => /^I[A-Z]/.test(f.typeName));
      expect(iPrefixed).toEqual([]);
    });
  });

  describe('Fragment spreads reference defined fragments (positive)', () => {
    it('all spreads in GET_CUSTOMER match a defined fragment', () => {
      const defined = new Set(extractFragmentTypes(GET_CUSTOMER).map(f => f.fragmentName));
      const spreads = extractFragmentSpreads(GET_CUSTOMER);
      const undefinedSpreads = spreads.filter(s => !defined.has(s));
      expect(undefinedSpreads).toEqual([]);
    });

    it('all spreads in combined movements query match a defined fragment', () => {
      const combined = GET_MOVEMENTS;
      const defined = new Set(extractFragmentTypes(combined).map(f => f.fragmentName));
      const spreads = extractFragmentSpreads(combined);
      const undefinedSpreads = spreads.filter(s => !defined.has(s));
      expect(undefinedSpreads).toEqual([]);
    });
  });

  describe('False-positive guard — detects I-prefix if reintroduced', () => {
    it('detects I-prefixed type in a fragment definition', () => {
      const badQuery = 'fragment Foo on IFoo { bar }';
      const fragments = extractFragmentTypes(badQuery);
      const iPrefixed = fragments.filter(f => /^I[A-Z]/.test(f.typeName));
      expect(iPrefixed).toHaveLength(1);
      expect(iPrefixed[0].typeName).toBe('IFoo');
    });

    it('detects undefined fragment spread', () => {
      const badQuery = `
        query { items { ...MissingFragment } }
        fragment DefinedFragment on Foo { bar }
      `;
      const defined = new Set(extractFragmentTypes(badQuery).map(f => f.fragmentName));
      const spreads = extractFragmentSpreads(badQuery);
      const undefinedSpreads = spreads.filter(s => !defined.has(s));
      expect(undefinedSpreads).toContain('MissingFragment');
    });
  });
});
