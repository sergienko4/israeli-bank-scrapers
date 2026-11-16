/**
 * One environment boundary. Production Pipeline code reads environment values
 * through `Types/Environment.ts`; every other module receives the snapshot or
 * reads the active run's copy. This policy scan uses the TypeScript AST, so a
 * `process.env` mention in a comment is not an offence.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';

import { runWithBankContext } from '../../../../Scrapers/Pipeline/Logging/BankContext.js';
import { ENVIRONMENT, readEnvironment } from '../../../../Scrapers/Pipeline/Types/Environment.js';
import { maskVisibleText } from '../../../../Scrapers/Pipeline/Types/LogEvent.js';
import { isPiiRedactionDisabled } from '../../../../Scrapers/Pipeline/Types/PiiRedactor/Types.js';

const MODULE_PATH = fileURLToPath(import.meta.url);
const HERE = path.dirname(MODULE_PATH);
const PIPELINE_ROOT = path.join(HERE, '..', '..', '..', '..', 'Scrapers', 'Pipeline');
const BOUNDARY = path.join('Types', 'Environment.ts');

/**
 * Every `.ts` file under the Pipeline tree, relative to its root.
 * @param root - Directory to walk.
 * @returns POSIX-style relative paths.
 */
function pipelineFiles(root: string): readonly string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...pipelineFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const relative = path.relative(PIPELINE_ROOT, full);
      out.push(relative);
    }
  }
  return out;
}

/**
 * Whether a node reads `process.env` or `process.argv`.
 * @param node - AST node.
 * @returns True for the forbidden property access.
 */
function isProcessRead(node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node)) return false;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'process') return false;
  return node.name.text === 'env' || node.name.text === 'argv';
}

/**
 * Collect forbidden process reads in one node and its children.
 * @param node - AST node.
 * @param relativePath - Pipeline-relative file path.
 * @returns Offending paths under this node.
 */
function childOffenders(node: ts.Node, relativePath: string): readonly string[] {
  const own = isProcessRead(node) ? [relativePath] : [];
  const nested = node.getChildren().flatMap(child => childOffenders(child, relativePath));
  return [...own, ...nested];
}

/**
 * Find forbidden process reads in one source file.
 * @param relativePath - Pipeline-relative file path.
 * @returns Offending file path, or empty.
 */
function processReadOffenders(relativePath: string): readonly string[] {
  const full = path.join(PIPELINE_ROOT, relativePath);
  const source = fs.readFileSync(full, 'utf8');
  const file = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true);
  return childOffenders(file, relativePath);
}

describe('Pipeline environment boundary', () => {
  it('reads process.env/argv only in Types/Environment.ts', () => {
    const offenders = pipelineFiles(PIPELINE_ROOT)
      .filter(relativePath => relativePath !== BOUNDARY)
      .flatMap(processReadOffenders);
    expect([...new Set(offenders)]).toStrictEqual([]);
  });

  it('normalizes the environment flags once', () => {
    const env = readEnvironment({
      FORENSIC_TRACE: ' TRUE ',
      RUNS_ROOT: '/tmp/runs',
      PRETTY_LOGS: 'true',
      LOG_LEVEL: 'debug',
      WINDOW_BACKFILL: 'off',
      PII_REDACTION: 'off',
      ONEZERO_MTLS_CERT: 'cert',
      ONEZERO_MTLS_KEY: 'key',
    });
    expect(env).toStrictEqual({
      forensicTrace: true,
      runsRoot: '/tmp/runs',
      prettyLogs: true,
      logLevel: 'debug',
      windowBackfillOff: true,
      piiRedactionOff: true,
      oneZeroMtlsCert: 'cert',
      oneZeroMtlsKey: 'key',
    });
  });

  it('defaults to trace off and the platform runs root', () => {
    expect(ENVIRONMENT.forensicTrace).toBe(false);
    expect(ENVIRONMENT.piiRedactionOff).toBe(false);
    expect(ENVIRONMENT.runsRoot.length).toBeGreaterThan(0);
  });

  it('places the default runs root under a per-user temp directory', () => {
    const env = readEnvironment({});
    const tempRoot = os.tmpdir();
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    const segment =
      uid === undefined ? 'israeli-bank-scrapers' : `israeli-bank-scrapers-${String(uid)}`;
    const expected = path.join(tempRoot, segment, 'runs');
    expect(env.runsRoot).toBe(expected);
  });

  it('applies each run’s privacy setting independently', () => {
    const off = readEnvironment({ PII_REDACTION: 'off' });
    const on = readEnvironment({ PII_REDACTION: 'on' });
    /**
     * Read the redaction flag in the off snapshot.
     * @returns True when redaction is disabled.
     */
    const readOff = (): boolean => runWithBankContext('onezero', isPiiRedactionDisabled, off);
    /**
     * Read the redaction flag in the on snapshot.
     * @returns False when redaction is enabled.
     */
    const readOn = (): boolean => runWithBankContext('onezero', isPiiRedactionDisabled, on);
    expect([readOff(), readOn()]).toEqual([true, false]);

    const sample = 'x'.repeat(40);
    const maskedOff = runWithBankContext('onezero', () => maskVisibleText(sample), off);
    const maskedOn = runWithBankContext('onezero', () => maskVisibleText(sample), on);
    expect([maskedOff.length, maskedOn.length]).toEqual([40, 33]);
  });
});
