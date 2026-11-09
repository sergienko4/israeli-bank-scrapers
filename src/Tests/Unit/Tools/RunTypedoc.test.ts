/**
 * Regression tests for `scripts/run-typedoc.mjs` and `typedoc.json`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createTempRepo, writeTempFile } from '../../Helpers/TempRepoTree.js';

type MatchOneFn = (
  file: string | readonly string[],
  pattern: unknown,
  partial?: boolean,
) => boolean;

interface IMinimatchInstance {
  readonly set: readonly unknown[];
  match: (path: string, partial?: boolean) => boolean;
  matchOne?: MatchOneFn;
}

interface IMinimatchClass {
  new (pattern: string): IMinimatchInstance;
  prototype: { matchOne?: MatchOneFn };
}

interface IRunTypedocModule {
  resolveFromTypedoc: (specifier: string) => string;
  matchOne: MatchOneFn;
  installMinimatchShim: (MinimatchClass: { prototype: { matchOne?: MatchOneFn } }) => boolean;
  isEntryPoint: (metaUrl: string, entryArg?: string) => boolean;
}

interface ITypedocConfig {
  readonly entryPoints?: readonly string[];
}

const ROOT = process.cwd();
const LAUNCHER_PATH = join(ROOT, 'scripts', 'run-typedoc.mjs');
const LAUNCHER_URL = pathToFileURL(LAUNCHER_PATH).href;
const LAUNCHER = (await import(LAUNCHER_URL)) as IRunTypedocModule;

/**
 * Stub `matchOne` implementation used to verify existing methods are preserved.
 * @returns Always true.
 */
function existingMatchOne(): boolean {
  return true;
}

/**
 * Writes a minimal nested TypeScript fixture for TypeDoc CLI execution.
 * @param root Temporary directory root.
 * @returns Path to the generated `typedoc.json`.
 */
function writeTypedocFixture(root: string): string {
  const pkgJson = JSON.stringify({ name: 'fixture', version: '1.0.0' });
  writeTempFile(root, 'package.json', pkgJson);
  writeTempFile(root, 'nested/entry.ts', 'export const answer = 42;\n');
  const tsconfigJson = JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' },
    include: ['nested/entry.ts'],
  });
  writeTempFile(root, 'tsconfig.json', tsconfigJson);
  const typedocJson = JSON.stringify({
    entryPoints: ['nested/entry.ts'],
    tsconfig: 'tsconfig.json',
    readme: 'none',
    out: 'out-docs',
  });
  return writeTempFile(root, 'typedoc.json', typedocJson);
}

/**
 * Runs `scripts/run-typedoc.mjs` against a temporary nested entry-point fixture.
 * @param root Temporary directory root.
 * @returns Exit status and combined output from the child process.
 */
function runLauncherOnFixture(root: string): { status: number; output: string } {
  const optionsPath = writeTypedocFixture(root);
  const res = spawnSync(process.execPath, [LAUNCHER_PATH, '--options', optionsPath], {
    cwd: root,
    encoding: 'utf8',
  });
  if (res.error) throw res.error;
  return { status: res.status ?? -1, output: `${res.stdout}${res.stderr}` };
}

describe('scripts/run-typedoc.mjs compatibility shim', () => {
  it('resolves minimatch from typedoc package context and shims matchOne', async () => {
    const minimatchUrl = LAUNCHER.resolveFromTypedoc('minimatch');
    const mod = (await import(minimatchUrl)) as { Minimatch: IMinimatchClass };
    const matcher = new mod.Minimatch('**/nested/entry.ts');
    const row = matcher.set[0];
    expect(matcher.matchOne?.(['nested'], row, true)).toBe(true);
    expect(matcher.matchOne?.('nested/entry.ts', row, false)).toBe(true);
    expect(matcher.matchOne?.(['other', 'file.ts'], row, false)).toBe(false);
  });

  it('preserves an existing matchOne implementation when already present', () => {
    const fakeClass = { prototype: { matchOne: existingMatchOne } };
    const wasInstalled = LAUNCHER.installMinimatchShim(fakeClass);
    expect(wasInstalled).toBe(false);
    expect(fakeClass.prototype.matchOne).toBe(existingMatchOne);
  });

  it('detects whether the launcher was invoked as the CLI entry script', () => {
    const isCli = LAUNCHER.isEntryPoint(LAUNCHER_URL, LAUNCHER_PATH);
    const isImported = LAUNCHER.isEntryPoint(LAUNCHER_URL, '');
    expect(isCli).toBe(true);
    expect(isImported).toBe(false);
  });

  it('generates TypeDoc HTML for a nested TypeScript entry point in a child process', () => {
    const root = createTempRepo();
    try {
      const result = runLauncherOnFixture(root);
      const htmlPath = join(root, 'out-docs', 'index.html');
      const hasHtml = existsSync(htmlPath);
      expect(result.status).toBe(0);
      expect(result.output).toContain('html generated at');
      expect(hasHtml).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps repository typedoc.json entryPoints pointing to existing source files', () => {
    const typedocPath = join(ROOT, 'typedoc.json');
    const raw = readFileSync(typedocPath, 'utf8');
    const config = JSON.parse(raw) as ITypedocConfig;
    const missing = (config.entryPoints ?? []).filter(entry => {
      const target = join(ROOT, entry);
      return !existsSync(target);
    });
    expect(missing).toEqual([]);
  });
});
