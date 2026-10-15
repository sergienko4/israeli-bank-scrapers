/**
 * Unit test for `scripts/browser-stack/gen-config.mjs`.
 *
 * <p>Runtime code reads the tested Camoufox tag and playwright-core minor
 * from `src/Scrapers/Pipeline/Mediator/Browser/BrowserStackConfig.ts`, which
 * the script renders from `browser-stack.json`. Its contract: the committed
 * module is the render of the committed manifest; a run writes only when the
 * module is stale, so a second run changes nothing; a missing module is stale
 * while any other read error surfaces; an invalid manifest exits 2 with
 * MANIFEST-INVALID and writes nothing; no other `src` file copies the
 * pinned tag; and the CLI takes no argument, so any argument is a usage
 * error that runs nothing, even through a symlinked entry path.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generate,
  GENERATED_PATH,
  GENERATED_REL,
  type IGenerateIo,
  isGeneratedStale,
  renderConfig,
} from '../../../../scripts/browser-stack/gen-config.mjs';
import { type IValidManifest, loadManifest } from '../../../../scripts/browser-stack/manifest.mjs';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import {
  TESTED_CAMOUFOX_TAG,
  TESTED_PLAYWRIGHT_MINOR,
} from '../../../Scrapers/Pipeline/Mediator/Browser/BrowserStackConfig.js';
import { canCreateSymlinks } from '../../Helpers/HostCapabilities.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const REPO_ROOT = join(THIS_DIR, '../../../../');
const SRC_ROOT = join(REPO_ROOT, 'src');
const REAL_MANIFEST = join(REPO_ROOT, 'browser-stack.json');
const SAMPLE_TAG = 'v100.0.0-beta.1';
const EDITED_TAG = 'v100.0.1-beta.2';
const GEN_CLI = join(REPO_ROOT, 'scripts/browser-stack/gen-config.mjs');
const GEN_USAGE = 'usage: node scripts/browser-stack/gen-config.mjs\n';

/** One generator run's files and captured output. */
interface ISandbox {
  readonly manifestPath: string;
  readonly generatedPath: string;
  readonly out: string[];
  readonly err: string[];
  readonly io: IGenerateIo;
}

const ROOTS: string[] = [];

afterEach(() => {
  for (const root of ROOTS.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A manifest file that must be valid.
 *
 * @param file - Manifest path; the committed one by default.
 * @returns Its typed fields.
 */
function manifestAt(file = REAL_MANIFEST): IValidManifest {
  const { manifest } = loadManifest(file);
  if (manifest === undefined) throw new ScraperError(`${file} is invalid`);
  return manifest;
}

/**
 * The committed manifest with another Camoufox tag, so the document stays
 * valid when the manifest schema gains a required field.
 *
 * @param tag - Camoufox tag.
 * @returns The document.
 */
function manifestDoc(tag: string): object {
  const committed = manifestAt();
  return { ...committed, camoufox: { ...committed.camoufox, tag } };
}

/**
 * Write a manifest document as JSON.
 *
 * @param file - Destination.
 * @param doc - Document.
 * @returns The file path.
 */
function writeManifest(file: string, doc: unknown): string {
  const text = JSON.stringify({ acceptedDeltas: [], ...(doc as object) });
  writeFileSync(file, text);
  return file;
}

/**
 * A fresh temp dir, removed after the test.
 *
 * @returns Its path.
 */
function tempDir(): string {
  const tempRoot = tmpdir();
  const prefix = join(tempRoot, 'browser-stack-gen-');
  const dir = mkdtempSync(prefix);
  ROOTS.push(dir);
  return dir;
}

/**
 * A temp dir holding a manifest with `tag` and no generated module yet.
 *
 * @param tag - Camoufox tag; an invalid one makes the manifest invalid.
 * @returns Paths, output buffers, and the run I/O.
 */
function sandbox(tag: string): ISandbox {
  const dir = tempDir();
  const manifestFile = join(dir, 'browser-stack.json');
  const doc = manifestDoc(tag);
  const manifestPath = writeManifest(manifestFile, doc);
  const generatedPath = join(dir, 'BrowserStackConfig.ts');
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    manifestPath,
    generatedPath,
    stdout: out.push.bind(out),
    stderr: err.push.bind(err),
  };
  return { manifestPath, generatedPath, out, err, io };
}

/** One spawned CLI run. */
interface ICliRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawn the generator CLI.
 *
 * @param entry - Script path given to node.
 * @param args - CLI arguments.
 * @returns Exit status (-1 when killed) and both output streams.
 */
function runGenCli(entry: string, args: readonly string[]): ICliRun {
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** What one `generate` run returned and left on disk. */
interface IGenerateRun {
  readonly code: number;
  readonly text: string;
}

/**
 * Run `generate` in a sandbox, then read the module.
 *
 * @param run - Sandbox.
 * @returns Exit code and module text (empty when absent).
 */
function generateIn(run: ISandbox): IGenerateRun {
  const code = generate(run.io);
  const isWritten = existsSync(run.generatedPath);
  const text = isWritten ? readFileSync(run.generatedPath, 'utf8') : '';
  return { code, text };
}

/**
 * Whether the sandbox module is stale against its current manifest.
 *
 * @param run - Sandbox.
 * @returns True when a run would rewrite it.
 */
function staleIn(run: ISandbox): boolean {
  const manifest = manifestAt(run.manifestPath);
  return isGeneratedStale(manifest, run.generatedPath);
}

/**
 * Repo-relative path of a file that `readdirSync` listed under `src`.
 *
 * @param entry - Path below `src`, in the platform's separators.
 * @param flavour - Path module of the platform; `path.win32` simulates Windows.
 * @returns The path, such as `src/Common/Browser.ts`.
 */
function repoRelOf(entry: string, flavour: typeof path.win32 = path): string {
  const native = flavour.join('src', entry);
  return native.split(flavour.sep).join(path.posix.sep);
}

/**
 * Every `.ts` file under `src`, repo-relative.
 *
 * @returns Paths such as `src/Common/Browser.ts`.
 */
function srcTsFiles(): string[] {
  const entries = readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf8' });
  const tsFiles = entries.filter((rel): boolean => rel.endsWith('.ts'));
  return tsFiles.map((rel): string => repoRelOf(rel));
}

/**
 * Whether a repo file contains `needle`.
 *
 * @param rel - Repo-relative path.
 * @param needle - Text to find.
 * @returns True when found.
 */
function fileHolds(rel: string, needle: string): boolean {
  const file = join(REPO_ROOT, rel);
  const text = readFileSync(file, 'utf8');
  return text.includes(needle);
}

describe('browser-stack gen-config', () => {
  it('[BGC-1] the committed module is the render of the committed manifest', () => {
    const manifest = manifestAt();
    const committed = readFileSync(GENERATED_PATH, 'utf8');
    const expected = renderConfig(manifest);
    const generatedAbs = join(REPO_ROOT, GENERATED_REL);
    expect(GENERATED_PATH).toBe(generatedAbs);
    expect(committed).toBe(expected);
  });

  it('[BGC-2] the module exports the manifest tag and testedMinor', () => {
    const manifest = manifestAt();
    expect(TESTED_CAMOUFOX_TAG).toBe(manifest.camoufox.tag);
    expect(TESTED_PLAYWRIGHT_MINOR).toBe(manifest.playwrightCore.testedMinor);
  });

  it('[BGC-3] a missing module is written; a second run leaves it as is', () => {
    const run = sandbox(SAMPLE_TAG);
    const first = generateIn(run);
    const second = generateIn(run);
    expect([first.code, second.code]).toEqual([0, 0]);
    expect(first.text).toContain(`export const TESTED_CAMOUFOX_TAG = '${SAMPLE_TAG}';`);
    expect(second.text).toBe(first.text);
    expect(run.out).toEqual([`${GENERATED_REL} written\n`, `${GENERATED_REL} already current\n`]);
    expect(run.err).toEqual([]);
  });

  it('[BGC-4] a manifest edit makes the module stale until the next run', () => {
    const run = sandbox(SAMPLE_TAG);
    generateIn(run);
    const editedDoc = manifestDoc(EDITED_TAG);
    writeManifest(run.manifestPath, editedDoc);
    const isStaleAfterEdit = staleIn(run);
    const rerun = generateIn(run);
    const isStaleAfterRerun = staleIn(run);
    expect(isStaleAfterEdit).toBe(true);
    expect(rerun.text).toContain(`export const TESTED_CAMOUFOX_TAG = '${EDITED_TAG}';`);
    expect(isStaleAfterRerun).toBe(false);
  });

  it('[BGC-5] a missing module is stale; any other read error surfaces', () => {
    const run = sandbox(SAMPLE_TAG);
    const isMissingStale = staleIn(run);
    mkdirSync(run.generatedPath);
    expect(isMissingStale).toBe(true);
    expect(() => staleIn(run)).toThrow(/EISDIR/u);
  });

  it('[BGC-6] an invalid manifest exits 2 with MANIFEST-INVALID and writes nothing', () => {
    const run = sandbox('latest');
    const result = generateIn(run);
    const stderr = run.err.join('');
    expect(result).toEqual({ code: 2, text: '' });
    expect(stderr).toMatch(/^MANIFEST-INVALID \/camoufox\/tag /u);
    expect(run.out).toEqual([]);
  });

  it('[BGC-7] no other src file copies the pinned Camoufox tag', () => {
    const { tag } = manifestAt().camoufox;
    const files = srcTsFiles();
    const holders = files.filter((rel): boolean => fileHolds(rel, tag));
    expect(holders).toEqual([GENERATED_REL]);
  });

  it('[BGC-8] a Windows listing maps to the POSIX GENERATED_REL', () => {
    const below = GENERATED_REL.slice('src/'.length);
    const entry = below.replaceAll('/', path.win32.sep);
    const rel = repoRelOf(entry, path.win32);
    expect(rel).toBe(GENERATED_REL);
  });

  it('[BGC-9] any argument is a usage error that runs nothing', () => {
    const run = runGenCli(GEN_CLI, ['--check']);
    expect(run).toEqual({ status: 2, stdout: '', stderr: GEN_USAGE });
  });

  it('[BGC-10] a symlinked entry path still runs the CLI', () => {
    if (canCreateSymlinks(process.platform)) {
      const dir = tempDir();
      const link = join(dir, 'gen-config.mjs');
      symlinkSync(GEN_CLI, link);
      const run = runGenCli(link, ['--check']);
      expect(run).toEqual({ status: 2, stdout: '', stderr: GEN_USAGE });
    }
  });
});
