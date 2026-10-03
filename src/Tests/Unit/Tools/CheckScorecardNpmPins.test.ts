/**
 * Unit test for `.github/scripts/ci/check-scorecard-npm-pins.mjs`.
 *
 * <p>The PR gate runs the pinned OpenSSF Scorecard engine over the merge tree
 * and hands its JSON result to this checker, which alone decides pass or fail:
 * Scorecard exits 0 whatever it finds. Three cases are verbatim Scorecard
 * v5.5.0 output, with only the scanned path and the date neutralised; every
 * other case is the clean result with exactly one property broken. The checker
 * must fail closed, so anything it cannot positively read as "every npm
 * command pinned, nothing skipped" is a failure.
 *
 * <p>The test spawns the real CLI, because its contract is its exit code.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const CHECKER = join(REPO_ROOT, '.github/scripts/ci/check-scorecard-npm-pins.mjs');
const FIXTURES = join(REPO_ROOT, 'src/Tests/Unit/Tools/Fixtures/ScorecardNpmPins');

/** Engine version the fixtures were produced by. */
const ENGINE = 'v5.5.0';

/** Exit codes the checker promises. */
const PASS = 0;
const FAIL = 1;
const USAGE = 2;

/** The verbatim summary line of the clean fixture. */
const CLEAN_SUMMARY = 'Info:   5 out of   5 npmCommand dependencies pinned';

/** The one check this gate reads, loose enough to hold the malformed cases. */
interface IScorecardCheck {
  name: unknown;
  score: unknown;
  reason: unknown;
  details: unknown;
}

/** A Scorecard JSON result, loose enough to hold the malformed cases. */
interface IScorecardResult {
  scorecard: { version: unknown };
  checks: unknown;
}

/** What one checker run reported. */
interface ICheckerRun {
  readonly status: number;
  readonly output: string;
}

/** A result body, the exit code it must produce, and text the report must name. */
interface ICheckerCase {
  readonly name: string;
  readonly body: string;
  readonly status: number;
  readonly says: string;
}

/**
 * Read a verbatim Scorecard result fixture.
 *
 * @param name - Fixture name without extension.
 * @returns The fixture's JSON text.
 */
function fixtureText(name: string): string {
  const file = join(FIXTURES, `${name}.json`);
  return readFileSync(file, 'utf8');
}

/**
 * The clean verbatim result, parsed.
 *
 * @returns A fresh copy.
 */
function cleanResult(): IScorecardResult {
  const text = fixtureText('clean');
  return JSON.parse(text) as IScorecardResult;
}

/**
 * The only check of the clean result.
 *
 * @returns A fresh copy.
 */
function cleanCheck(): IScorecardCheck {
  const { checks } = cleanResult();
  return (checks as IScorecardCheck[])[0];
}

/** The clean result's only check, and its detail lines. */
const CLEAN_CHECK = cleanCheck();
const CLEAN_DETAILS = CLEAN_CHECK.details as readonly unknown[];

/**
 * The clean result with top-level properties replaced.
 *
 * @param patch - Properties to replace.
 * @returns The changed result as JSON text.
 */
function cleanWithResult(patch: Partial<IScorecardResult>): string {
  const result = cleanResult();
  return JSON.stringify({ ...result, ...patch });
}

/**
 * The clean result with properties of its only check replaced.
 *
 * @param patch - Check properties to replace.
 * @returns The changed result as JSON text.
 */
function cleanWithCheck(patch: Partial<IScorecardCheck>): string {
  const check = cleanCheck();
  return cleanWithResult({ checks: [{ ...check, ...patch }] });
}

/**
 * The clean result with one more detail line.
 *
 * @param extra - Line to append.
 * @returns The changed result as JSON text.
 */
function cleanWithDetail(extra: unknown): string {
  return cleanWithCheck({ details: [...CLEAN_DETAILS, extra] });
}

/**
 * The clean result with its npm summary line replaced.
 *
 * @param line - Replacement line, or empty to drop the summary.
 * @returns The changed result as JSON text.
 */
function withSummary(line: string): string {
  const lines = CLEAN_DETAILS.map(detail => (detail === CLEAN_SUMMARY ? line : detail));
  return cleanWithCheck({ details: lines.filter(detail => detail !== '') });
}

/**
 * Run the checker as a child process.
 *
 * @param args - Command-line arguments.
 * @returns Exit status, with -1 for a signalled exit, and combined output.
 */
function spawnChecker(args: readonly string[]): ICheckerRun {
  const options = { encoding: 'utf8' } as const;
  const result = spawnSync(process.execPath, [CHECKER, ...args], options);
  if (result.error) throw result.error;
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

/**
 * Run the checker on a result body written to a throwaway file.
 *
 * @param body - Scorecard result text.
 * @returns What the checker reported.
 */
function checkBody(body: string): ICheckerRun {
  const temp = tmpdir();
  const prefix = join(temp, 'scorecard-npm-pins-');
  const dir = mkdtempSync(prefix);
  try {
    const file = join(dir, 'result.json');
    writeFileSync(file, body, 'utf8');
    return spawnChecker([file, ENGINE]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CASES: readonly ICheckerCase[] = [
  {
    name: 'verbatim: every npm command pinned',
    body: fixtureText('clean'),
    status: PASS,
    says: CLEAN_SUMMARY,
  },
  {
    name: 'verbatim: unpinned npm commands',
    body: fixtureText('unpinned'),
    status: FAIL,
    says: 'npmCommand not pinned by hash: .github/workflows/release.yml:167',
  },
  {
    name: 'verbatim: shell that does not parse',
    body: fixtureText('incomplete'),
    status: FAIL,
    says: 'Possibly incomplete results',
  },
  {
    name: 'a different engine version',
    body: cleanWithResult({ scorecard: { version: 'v5.4.0' } }),
    status: FAIL,
    says: 'v5.4.0',
  },
  {
    name: 'two checks',
    body: cleanWithResult({ checks: [CLEAN_CHECK, CLEAN_CHECK] }),
    status: FAIL,
    says: 'exactly one Pinned-Dependencies check',
  },
  {
    name: 'a different check',
    body: cleanWithCheck({ name: 'Token-Permissions' }),
    status: FAIL,
    says: 'exactly one Pinned-Dependencies check',
  },
  {
    name: 'checks that are not a list',
    body: cleanWithResult({ checks: {} }),
    status: FAIL,
    says: 'no checks list',
  },
  {
    name: 'an inconclusive score',
    body: cleanWithCheck({ score: -1 }),
    status: FAIL,
    says: 'inconclusive',
  },
  {
    name: 'a score that is a string',
    body: cleanWithCheck({ score: '10' }),
    status: FAIL,
    says: 'is not a number from 0 to 10',
  },
  {
    name: 'a score above ten',
    body: cleanWithCheck({ score: 11 }),
    status: FAIL,
    says: 'is not a number from 0 to 10',
  },
  {
    name: 'a reason that is not text',
    body: cleanWithCheck({ reason: [] }),
    status: FAIL,
    says: 'reason is not text',
  },
  {
    name: 'no details',
    body: cleanWithCheck({ details: [] }),
    status: FAIL,
    says: 'details are missing or not all text',
  },
  {
    name: 'a detail that is not text',
    body: cleanWithDetail(7),
    status: FAIL,
    says: 'details are missing or not all text',
  },
  {
    name: 'no npm summary',
    body: withSummary(''),
    status: FAIL,
    says: 'found 0',
  },
  {
    name: 'two npm summaries',
    body: cleanWithDetail(CLEAN_SUMMARY),
    status: FAIL,
    says: 'found 2',
  },
  {
    name: 'a summary with one npm command unpinned',
    body: withSummary('Info:   4 out of   5 npmCommand dependencies pinned'),
    status: FAIL,
    says: '4 out of   5',
  },
  {
    name: 'a summary with no npm commands',
    body: withSummary('Info:   0 out of   0 npmCommand dependencies pinned'),
    status: FAIL,
    says: '0 out of   0',
  },
  {
    name: 'an npm warning worded differently',
    body: cleanWithDetail('Warn: npmCommand has an unexpected form: a.sh:1'),
    status: FAIL,
    says: 'npmCommand has an unexpected form',
  },
  {
    name: 'an incomplete-results line beside a full summary',
    body: cleanWithDetail('Info: Possibly incomplete results: error parsing: a.sh:0'),
    status: FAIL,
    says: 'Possibly incomplete results',
  },
  { name: 'a JSON array', body: '[]', status: FAIL, says: 'no checks list' },
  { name: 'text that is not JSON', body: '{', status: FAIL, says: 'cannot read' },
];

describe('check-scorecard-npm-pins', () => {
  it.each(CASES)('$name exits $status', row => {
    const run = checkBody(row.body);
    expect(run.output).toContain(row.says);
    expect(run.status).toBe(row.status);
  });

  it('names every unpinned npm command of the verbatim result', () => {
    const body = fixtureText('unpinned');
    const run = checkBody(body);
    expect(run.output).toContain('.github/scripts/ci/consumer-install.sh:105');
    expect(run.output).toContain('.github/workflows/release.yml:167');
  });

  it('ignores warnings about other dependency types', () => {
    const body = fixtureText('clean');
    const run = checkBody(body);
    expect(body).toContain('Warn: third-party GitHubAction not pinned by hash');
    expect(run.status).toBe(PASS);
  });

  it('fails closed on a result file that does not exist', () => {
    const missing = join(FIXTURES, 'missing.json');
    const run = spawnChecker([missing, ENGINE]);
    expect(run.output).toContain('cannot read');
    expect(run.status).toBe(FAIL);
  });

  it.each([[[]], [['result.json']]])('rejects arguments %j as a usage error', args => {
    const run = spawnChecker(args);
    expect(run.output).toContain('Usage');
    expect(run.status).toBe(USAGE);
  });
});
