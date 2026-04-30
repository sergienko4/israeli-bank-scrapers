/**
 * Unit tests for `src/Tests/Tools/LintValidator.ts` — the pure-helper
 * library that powers `lint-and-validate.ts` and the pre-commit
 * architecture gate. Tests pin every enforcement path + exclusion rule.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  analyzeFile,
  expandToFiles,
  isExcluded,
  issuesFromCode,
  loadAllowlist,
  type RuleKey,
} from '../../../Tests/Tools/LintValidator.js';

/** Synthetic Pipeline path — forces scope-sensitive rules to fire. */
const SYNTHETIC_PIPELINE = 'src/Scrapers/Pipeline/TestOnly/synthetic.ts';
/** Synthetic Phase path — enables Rule #10. */
const SYNTHETIC_PHASE = 'src/Scrapers/Pipeline/Phases/TestOnly/synthetic.ts';
/** Synthetic non-Pipeline path. */
const SYNTHETIC_OTHER = 'src/Common/synthetic.ts';

/** Primitive-return fixture code — has exactly ONE flagged return type. */
const CODE_PRIMITIVE_ONE =
  'export function bareReturn(): string {\n' +
  "  return 'x';\n" +
  '}\n' +
  'export function unionReturn(): string | false {\n' +
  "  return 'x';\n" +
  '}\n' +
  'export function arrayReturn(): string[] {\n' +
  '  return [];\n' +
  '}\n' +
  'export interface IFoo {\n' +
  '  name: string;\n' +
  '  active: boolean;\n' +
  '}\n' +
  "export const defaultLabel: string = 'x';\n";

/** Factory-arrow fixture — must NOT trigger [Async]. */
const CODE_FACTORY_SAFE = [
  'const factories = [1, 2, 3].map((i) => () => fetchX(`card` + i));',
  'const QUERY = `query fetchBalance($id: String!) { accounts { balance } }`;',
].join('\n');

/** Unawaited-call fixture — MUST trigger [Async]. */
const CODE_UNAWAITED_CALL =
  'async function executeStep(name: string) { await Promise.resolve(); }\n' +
  'function dispatchBare() {\n' +
  "  executeStep('x');\n" +
  '}\n';

/**
 * Convert a path to forward-slash form for OS-agnostic assertions.
 * @param p - Path with any separator.
 * @returns Normalised path.
 */
function toFwd(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Create a temporary directory for walker tests.
 * @returns Absolute path to a fresh temp dir.
 */
function makeTempDir(): string {
  const tempRoot = os.tmpdir();
  const base = path.join(tempRoot, 'lint-validator-test-');
  const fresh = fs.mkdtempSync(base);
  return fresh;
}

/**
 * Check whether at least one path ends with the given suffix.
 * @param paths - Candidate paths.
 * @param suffix - String to match at end-of-path.
 * @returns True iff any path ends with the suffix.
 */
function anyEndsWith(paths: readonly string[], suffix: string): boolean {
  return paths.some((p): boolean => p.endsWith(suffix));
}

describe('expandToFiles', () => {
  it('expands a directory to its .ts files recursively', () => {
    const dir = makeTempDir();
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    const a = path.join(dir, 'a.ts');
    const b = path.join(sub, 'b.ts');
    const c = path.join(dir, 'c.md');
    fs.writeFileSync(a, '');
    fs.writeFileSync(b, '');
    fs.writeFileSync(c, '');
    const out = expandToFiles([dir]);
    const asFwd = out.map(toFwd);
    const hasA = anyEndsWith(asFwd, '/a.ts');
    const hasB = anyEndsWith(asFwd, '/b.ts');
    const hasMd = anyEndsWith(asFwd, '/c.md');
    expect(hasA).toBe(true);
    expect(hasB).toBe(true);
    expect(hasMd).toBe(false);
  });

  it('passes a file argument through unchanged', () => {
    const dir = makeTempDir();
    const a = path.join(dir, 'a.ts');
    fs.writeFileSync(a, '');
    const out = expandToFiles([a]);
    expect(out.length).toBe(1);
    expect(out[0]).toBe(a);
  });

  it('skips non-existent paths without throwing', () => {
    const dir = makeTempDir();
    const a = path.join(dir, 'a.ts');
    fs.writeFileSync(a, '');
    const out = expandToFiles(['src/no-such-dir-xyz', a]);
    expect(out.length).toBe(1);
  });

  it('skips non-.ts files when walking a directory', () => {
    const dir = makeTempDir();
    const aPath = path.join(dir, 'a.ts');
    const bPath = path.join(dir, 'b.md');
    const cPath = path.join(dir, 'c.snap');
    fs.writeFileSync(aPath, '');
    fs.writeFileSync(bPath, '');
    fs.writeFileSync(cPath, '');
    const out = expandToFiles([dir]);
    for (const p of out) {
      const hasTsExt = p.endsWith('.ts');
      expect(hasTsExt).toBe(true);
    }
  });
});

describe('isExcluded', () => {
  const cases: readonly { path: string; expected: boolean }[] = [
    { path: 'src/Scrapers/Pipeline/EslintCanaries/foo.canary.ts', expected: true },
    { path: 'src/Scrapers/Pipeline/Types/X.canary.ts', expected: true },
    { path: 'node_modules/pkg/index.ts', expected: true },
    { path: 'a/node_modules/pkg/index.ts', expected: true },
    { path: 'lib/index.ts', expected: true },
    { path: 'a/lib/index.ts', expected: true },
    { path: 'dist/index.ts', expected: true },
    { path: 'a/dist/index.ts', expected: true },
    { path: 'src/Scrapers/Pipeline/Types/RunLabel.ts', expected: false },
    { path: 'src/Tests/Unit/Foo.test.ts', expected: false },
  ];

  for (const c of cases) {
    it(`returns ${String(c.expected)} for "${c.path}"`, () => {
      const isActual = isExcluded(c.path);
      expect(isActual).toBe(c.expected);
    });
  }
});

describe('issuesFromCode — Rule #15 primitive return', () => {
  it('flags exactly one bare primitive return in a Pipeline-scoped file', () => {
    const issues = issuesFromCode(SYNTHETIC_PIPELINE, CODE_PRIMITIVE_ONE, new Map());
    const r15 = issues.filter((i): boolean => i.rule === 'Rule #15');
    expect(r15.length).toBe(1);
  });

  it('does NOT flag when file is outside Pipeline scope', () => {
    const issues = issuesFromCode(SYNTHETIC_OTHER, CODE_PRIMITIVE_ONE, new Map());
    const r15 = issues.filter((i): boolean => i.rule === 'Rule #15');
    expect(r15.length).toBe(0);
  });
});

describe('issuesFromCode — [Async] check', () => {
  it('does not flag factory-arrow or template-literal patterns', () => {
    const issues = issuesFromCode(SYNTHETIC_PIPELINE, CODE_FACTORY_SAFE, new Map());
    const async = issues.filter((i): boolean => i.rule === '[Async]');
    expect(async.length).toBe(0);
  });

  it('flags a bare unawaited execute/fetch/run/step call in Pipeline scope', () => {
    const issues = issuesFromCode(SYNTHETIC_PIPELINE, CODE_UNAWAITED_CALL, new Map());
    const async = issues.filter((i): boolean => i.rule === '[Async]');
    expect(async.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT flag unawaited calls outside Pipeline scope', () => {
    const issues = issuesFromCode(SYNTHETIC_OTHER, CODE_UNAWAITED_CALL, new Map());
    const async = issues.filter((i): boolean => i.rule === '[Async]');
    expect(async.length).toBe(0);
  });
});

describe('issuesFromCode — Rule #10 Playwright leak', () => {
  it('flags playwright imports in a Phase file', () => {
    const code = "import { Page } from 'playwright';\n";
    const issues = issuesFromCode(SYNTHETIC_PHASE, code, new Map());
    const r10 = issues.filter((i): boolean => i.rule === 'Rule #10');
    expect(r10.length).toBe(1);
  });

  it('does NOT flag playwright imports in non-Phase pipeline files', () => {
    const code = "import { Page } from 'playwright';\n";
    const issues = issuesFromCode(SYNTHETIC_PIPELINE, code, new Map());
    const r10 = issues.filter((i): boolean => i.rule === 'Rule #10');
    expect(r10.length).toBe(0);
  });
});

describe('loadAllowlist', () => {
  it('returns an empty map when no file exists', () => {
    const map = loadAllowlist('non-existent-allowlist-xyz.json');
    expect(map.size).toBe(0);
  });

  it('suppresses specified rules in the allowed file', () => {
    const allow = new Map<string, ReadonlySet<RuleKey>>([
      [SYNTHETIC_PIPELINE, new Set<RuleKey>(['Rule #15'])],
    ]);
    const issues = issuesFromCode(SYNTHETIC_PIPELINE, CODE_PRIMITIVE_ONE, allow);
    const r15 = issues.filter((i): boolean => i.rule === 'Rule #15');
    expect(r15.length).toBe(0);
  });
});

describe('analyzeFile — file-read wrapper', () => {
  it('returns empty list for a non-existent file', () => {
    const issues = analyzeFile('src/no-such-file-xyz.ts', new Map());
    expect(issues.length).toBe(0);
  });

  it('returns issues after reading a real file in Pipeline scope', () => {
    const dir = makeTempDir();
    const fullPath = path.join(dir, 'Scrapers', 'Pipeline', 'Fake.ts');
    const parentDir = path.dirname(fullPath);
    fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(fullPath, CODE_PRIMITIVE_ONE, 'utf8');
    const issues = analyzeFile(fullPath, new Map());
    const r15 = issues.filter((i): boolean => i.rule === 'Rule #15');
    expect(r15.length).toBe(1);
  });
});
