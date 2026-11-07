/**
 * Guards `scripts/check-plan-refs.mjs`, the gate that keeps local planning
 * IDs out of added lines.
 *
 * Every sample ID below is assembled at runtime. Written out whole, it would
 * be an added line citing a planning ID, and this file would fail the very
 * gate it tests.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface IPlanRefFinding {
  file: string;
  line: number;
  rule: string;
}

interface IPlanRefGate {
  isSkipped: (file: string) => boolean;
  /** Yields the broken rule's name, or `null` when the line is clean. */
  ruleBrokenBy: (line: string) => unknown;
  findPlanRefs: (diff: string) => IPlanRefFinding[];
}

const REPO_ROOT = process.cwd();
const GATE_PATH = join(REPO_ROOT, 'scripts', 'check-plan-refs.mjs');
const GATE_URL = pathToFileURL(GATE_PATH);
const GATE = (await import(GATE_URL.href)) as IPlanRefGate;

/**
 * Joins the two halves of a sample line, so no whole ID is written here.
 * @param head Text up to the middle of the ID.
 * @param tail The rest of the line.
 * @returns The joined sample line.
 */
function sample(head: string, tail: string): string {
  return `${head}${tail}`;
}

/** One sample per rule family, paired with the rule it must break. */
const PLAN_IDS: [string, string][] = [
  [sample('see the spec', ' §5 contract'), 'plan section mark'],
  [sample('see plan.md', ' §3'), 'plan section mark'],
  [sample('Spec', ' §5'), 'plan section mark'],
  [sample('plan.md', '  §3'), 'plan section mark'],
  [sample('// N', '33: keep the order'), 'plan item number'],
  [sample('(D', '12)'), 'plan item number'],
  [sample('DN', '4 covers it'), 'plan item number'],
  [sample('the E', '7 guard'), 'plan item number'],
  [sample('quoted `N', '33` here'), 'plan item number'],
  [sample("it('N", "33: keeps the order')"), 'plan item number'],
  [sample('if (D', '12 === x)'), 'plan item number'],
  [sample("it('N", "33', run)"), 'plan item number'],
  [sample('describe("D', '12", run)'), 'plan item number'],
  [sample("it.each(CASES)('N", "33: keeps the order', run)"), 'plan item number'],
  [sample('see {N', '33}'), 'plan item number'],
  [sample('D', '3 => use the form'), 'plan item number'],
  [sample('D', '3=>x'), 'plan item number'],
  [sample('if (D', '12===x)'), 'plan item number'],
  [sample("  'N", "33',"), 'plan item number'],
  [sample('per AD', '12'), 'plan decision ID'],
  [sample('per AD-', 'C'), 'plan decision ID'],
  [sample('done in T15', '.9'), 'plan task number'],
  [sample('done in M3', '.T5'), 'plan task number'],
  [sample('covers SEC-', '02'), 'plan test ID'],
];

/** Tokens that look like planning IDs but are ordinary text. */
const LOOKALIKES = [
  'G3',
  'C0',
  'SEC1',
  'MI6',
  'P-7',
  'P-256',
  '2024-01-01T00:00',
  'UTF-8',
  'SHA-256',
  'AES-256',
  'E2E',
  'TC-N2',
  'R-NET-SCRAPE',
  'AD-PRE-1',
  'AD-HM-2',
  'ADS2',
  'CARD-1',
  '%E0',
  '#E1E1E1',
  '1E3',
  'abc+N3/x',
  'v1.2.3',
  "const D0 = '/acceptedDeltas/0';",
  'const D0 =',
  'at ${D0}/channel',
  "{ error_code: 'E42' }",
  '{ code: "E123" }',
  sample("const encoded = 'D", "12/abc=';"),
  sample("const e = new Error('E", "42');"),
  sample("const s = JSON.stringify('E", "42');"),
  sample("expect(code).toBe('E", "123');"),
  sample("const color = '#AD", "4';"),
  sample("const color = '#AD", "1234';"),
  sample("const u = '%AD", "1';"),
  sample("if (errorCodePattern.test('E", "42')) {}"),
  'D1234',
  'D1_x',
  'שדהN2',
  'N2שדה',
  sample('N', '2\u0301'),
];

/**
 * Builds a zero-context diff that adds the given lines to one file.
 * @param file Repo-relative path.
 * @param added Added lines, without their `+` marker.
 * @returns Diff text as `git diff --unified=0` prints it.
 */
function diffAdding(file: string, added: string[]): string {
  const header = [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`];
  const hunk = `@@ -10,0 +11,${String(added.length)} @@`;
  const body = added.map(line => `+${line}`);
  return [...header, hunk, ...body].join('\n');
}

describe('check-plan-refs rules', () => {
  it.each(PLAN_IDS)('flags "%s" as %s', (line, rule) => {
    const broken = GATE.ruleBrokenBy(line);
    expect(broken).toBe(rule);
  });

  it.each(LOOKALIKES)('leaves the look-alike "%s" alone', token => {
    const broken = GATE.ruleBrokenBy(`value ${token} here`);
    expect(broken).toBeNull();
  });
});

describe('check-plan-refs skipped paths', () => {
  it.each([
    'src/Tests/E2eMocked/Fixtures/login.json',
    'src/fixture/page.txt',
    'docs/page.html',
    'src/a.test.ts.snap',
    'package-lock.json',
    'CHANGELOG.md',
    'docs/phase-7-consolidation-map.md',
  ])('skips %s', file => {
    const isSkipped = GATE.isSkipped(file);
    expect(isSkipped).toBe(true);
  });

  it('scans ordinary source', () => {
    const isSkipped = GATE.isSkipped('src/Scrapers/Pipeline/a.ts');
    expect(isSkipped).toBe(false);
  });
});

describe('check-plan-refs diff reading', () => {
  const planLine = sample('// keeps N', '33');

  it('reports the new-file line number of an offending addition', () => {
    const diff = diffAdding('src/a.ts', ['const clean = 1;', planLine]);
    const found = GATE.findPlanRefs(diff);
    expect(found).toEqual([{ file: 'src/a.ts', line: 12, rule: 'plan item number' }]);
  });

  it('ignores removed lines', () => {
    const lines = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -3 +2,0 @@'];
    const diff = [...lines, `-${planLine}`].join('\n');
    const found = GATE.findPlanRefs(diff);
    expect(found).toEqual([]);
  });

  it('ignores additions to a skipped path', () => {
    const diff = diffAdding('src/Fixtures/page.json', [planLine]);
    const found = GATE.findPlanRefs(diff);
    expect(found).toEqual([]);
  });

  // Regression: git ends a header path that holds a space with a tab,
  // which leaked into the reported file name.
  it('drops the tab git appends to a path holding a space', () => {
    const header = ['diff --git a/b c.ts b/b c.ts', '--- a/b c.ts', '+++ b/b c.ts\t'];
    const diff = [...header, '@@ -0,0 +1 @@', `+${planLine}`].join('\n');
    const found = GATE.findPlanRefs(diff);
    expect(found).toEqual([{ file: 'b c.ts', line: 1, rule: 'plan item number' }]);
  });

  // Regression: git quotes a path holding a quote or a backslash and
  // escapes those characters inside it.
  it('decodes a quoted header path', () => {
    const header = [
      'diff --git "a/say \\"hi\\".ts" "b/say \\"hi\\".ts"',
      '+++ "b/say \\"hi\\".ts"',
    ];
    const diff = [...header, '@@ -0,0 +1 @@', `+${planLine}`].join('\n');
    const found = GATE.findPlanRefs(diff);
    expect(found).toEqual([{ file: 'say "hi".ts', line: 1, rule: 'plan item number' }]);
  });

  it('decodes an octal escape in a quoted header path', () => {
    const header = ['diff --git "a/a\\001b.ts" "b/a\\001b.ts"', '+++ "b/a\\001b.ts"'];
    const diff = [...header, '@@ -0,0 +1 @@', `+${planLine}`].join('\n');
    const found = GATE.findPlanRefs(diff);
    expect(found).toEqual([{ file: 'a\u0001b.ts', line: 1, rule: 'plan item number' }]);
  });

  // Regression: `diff.mnemonicPrefix` writes `+++ i/…`, so a one-letter
  // prefix must be stripped like git's usual `b/`.
  it('strips a one-letter diff prefix from the header path', () => {
    const header = ['diff --git i/src/a.ts w/src/a.ts', '+++ i/src/a.ts'];
    const diff = [...header, '@@ -0,0 +1 @@', `+${planLine}`].join('\n');
    const found = GATE.findPlanRefs(diff);
    expect(found).toEqual([{ file: 'src/a.ts', line: 1, rule: 'plan item number' }]);
  });

  it('skips a generated file under a one-letter diff prefix', () => {
    const header = ['diff --git i/CHANGELOG.md w/CHANGELOG.md', '+++ i/CHANGELOG.md'];
    const diff = [...header, '@@ -0,0 +1 @@', `+${planLine}`].join('\n');
    const found = GATE.findPlanRefs(diff);
    expect(found).toEqual([]);
  });

  // Regression: an added line that opens with `++` reaches the diff as
  // `+++ …`, which a header-blind reader took for a new file name.
  it('reads an added line opening with ++ as content', () => {
    const diff = diffAdding('src/a.ts', [`++ ${planLine}`]);
    const found = GATE.findPlanRefs(diff);
    expect(found).toEqual([{ file: 'src/a.ts', line: 11, rule: 'plan item number' }]);
  });
});
