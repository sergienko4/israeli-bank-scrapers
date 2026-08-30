/**
 * Locks the docs front-matter reader to the CI gate's grammar.
 *
 * <p>The reader exists to answer one question: would
 * `.github/scripts/ci/docs-staleness.sh` treat this page as enrolling this
 * module? Accepting more than the gate reports coverage that CI never
 * delivers; accepting less fails the build over coverage that is real. Both
 * directions are pinned here, including the places where mirroring the gate
 * means accepting something YAML would not.
 *
 * <p>Every expectation below was taken by replaying the gate's own parser over
 * the same fixture, not by reading its source and inferring an outcome.
 */
import enrolledSources from './DocsFrontMatter.js';

const MODULE = 'src/Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnSign.ts';

const FENCE = '```yaml';

/**
 * Joins fixture lines into a page.
 *
 * @param lines - The page's lines, in order.
 * @returns The page's text.
 */
function makePage(...lines: readonly string[]): string {
  return lines.join('\n');
}

const PLAIN = makePage(
  '---',
  'title: T',
  'source-files:',
  `  - ${MODULE}`,
  '---',
  '',
  `- ${MODULE}`,
);

const FENCED = makePage('---', 'title: T', '---', '', FENCE, 'source-files:', `  - ${MODULE}`);

const SECOND = makePage(
  '---',
  'title: T',
  '---',
  '',
  '---',
  'source-files:',
  `  - ${MODULE}`,
  '---',
);

const EXOTIC = makePage('---', 'source-files:  ', '  # why', '', `  - "${MODULE}"`, '---');

const SIBLING = makePage(
  '---',
  'source-files:',
  `  - ${MODULE}`,
  'title: T',
  '  - other.ts',
  '---',
);

const NESTED = makePage('---', 'source-files:', '  - group:', `      - ${MODULE}`, '---');

const QUOTED = makePage('---', 'source-files:', `  - "'${MODULE}'"`, '---');

const TRAILING = makePage('---', 'source-files:', `  - "${MODULE}"  `, '---');

const REPEATED = makePage(
  '---',
  'source-files:',
  `  - ${MODULE}`,
  'title: T',
  'source-files:',
  '  - second.ts',
  '---',
);

const EMPTY = makePage('---', 'source-files:', '  - ""', `  - ${MODULE}`, '---');

const CR_AT_EOF = ['---', 'source-files:', `  - "${MODULE}"\r`].join('\r\n');

const VTAB = makePage('---', 'source-files:\v', `  - ${MODULE}`, '---');

const BARE = makePage('source-files:', `  - ${MODULE}`);

describe('docs front-matter enrolment reader', () => {
  it('reads a declared source and stops at the closing delimiter', () => {
    const found = enrolledSources(PLAIN);
    expect(found).toEqual([MODULE]);
  });

  it('ignores a declaration inside a fenced body block, as the gate does', () => {
    const found = enrolledSources(FENCED);
    expect(found).toEqual([]);
  });

  it('ignores a second front-matter-looking block, as the gate does', () => {
    const found = enrolledSources(SECOND);
    expect(found).toEqual([]);
  });

  it('reads past comments and blanks, and strips quotes, as the gate does', () => {
    const found = enrolledSources(EXOTIC);
    expect(found).toEqual([MODULE]);
  });

  it('ends the list at a sibling key', () => {
    const found = enrolledSources(SIBLING);
    expect(found).toEqual([MODULE]);
  });

  it('returns nothing when the page has no front matter', () => {
    const found = enrolledSources(BARE);
    expect(found).toEqual([]);
  });

  // The gate's list regex matches any indented dash, so it emits both lines of
  // a nested sequence. Mirroring that is deliberate: this reader reports the
  // gate's behaviour, not YAML's, and a page written this way really is covered.
  it('matches the gate on nested sequences rather than on YAML semantics', () => {
    const found = enrolledSources(NESTED);
    expect(found).toEqual(['group:', MODULE]);
  });

  // The gate strips one double quote then one single quote from each end, as
  // four independent operations, so a doubly quoted entry loses both pairs.
  it('strips double and single quotes independently, as the gate does', () => {
    const found = enrolledSources(QUOTED);
    expect(found).toEqual([MODULE]);
  });

  // The gate strips quotes before trimming, so a trailing space strands the
  // closing quote inside the recorded path. Trimming first would yield a clean
  // path the gate never registers — coverage the build would not enforce.
  it('keeps a quote stranded by trailing space, as the gate does', () => {
    const found = enrolledSources(TRAILING);
    expect(found).toEqual([`${MODULE}"`]);
  });

  // A sibling key closes the list but does not end the page's enrolment: the
  // gate tests every line for the key, so a later one reopens the list.
  it('reopens the list when the key appears a second time', () => {
    const found = enrolledSources(REPEATED);
    expect(found).toEqual([MODULE, 'second.ts']);
  });

  // The gate emits only non-empty values, so an entry that is nothing but
  // quotes enrols no file at all.
  it('drops an entry that normalises to nothing', () => {
    const found = enrolledSources(EMPTY);
    expect(found).toEqual([MODULE]);
  });

  // The gate strips a trailing carriage return before it looks for quotes, so
  // a CRLF page whose last line has no newline still yields a clean path.
  it('strips a carriage return left at end of file', () => {
    const found = enrolledSources(CR_AT_EOF);
    expect(found).toEqual([MODULE]);
  });

  // POSIX [[:space:]] covers vertical tab and form feed, which the key and
  // entry patterns must accept for the reader to see what the gate sees.
  it('accepts the whole POSIX blank class after the key', () => {
    const found = enrolledSources(VTAB);
    expect(found).toEqual([MODULE]);
  });
});
