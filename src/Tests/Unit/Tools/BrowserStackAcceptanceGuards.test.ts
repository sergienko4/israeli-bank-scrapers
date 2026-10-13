/**
 * Browser-stack acceptance guards.
 *
 * <p>`browser-stack.json` accepts Juggler deltas that break only a feature
 * this package does not use (HTTP credentials) or a method playwright-core
 * never sends (`Browser.setScreencastOptions`). The gate that reads the
 * manifest runs only when the browser stack moves, so a src-only change
 * could start using one of them and leave a now-harmful delta accepted. This
 * suite runs with the unit tests on every src change and checks the premise
 * of each acceptance.
 *
 * Rules:
 *   BSG-1  every accepted delta has exactly one guard, and every guard a delta
 *   BSG-2  no usage guard matches non-test src
 *   BSG-3  both context builders set no option that sends a guarded command
 *   BSG-4  every context src creates takes its options from a builder: each
 *          newContext gets an untouched const the checker resolves to a
 *          builder, each newPage runs on a playwright BrowserContext, and no
 *          persistent context exists
 *   BSG-5  playwright-core still never sends a method Camoufox lacks
 *   BSG-6  each pattern flags a planted use and passes clean code
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildContextOptions as commonContextOptions } from '../../../Common/Browser.js';
import { buildContextOptions as pipelineContextOptions } from '../../../Scrapers/Pipeline/Mediator/Browser/BrowserContextBuilder.js';
import {
  builtContextCount,
  CONTEXT_NAME_RE,
  contextFindings,
  type IContextProgram,
} from '../../Helpers/ContextCreationGuard.js';
import { type IMemoryFile, programOf, repoCompilerOptions } from '../../Helpers/TsProgram.js';

const REPO_ROOT = process.cwd();
const SRC_DIR = path.join(REPO_ROOT, 'src');
const TESTS_DIR = path.join(SRC_DIR, 'Tests');
const CORE_LIB_DIR = path.join(REPO_ROOT, 'node_modules', 'playwright-core', 'lib');
const MANIFEST = path.join(REPO_ROOT, 'browser-stack.json');

/** A Juggler send playwright-core makes, proving the core scan reads its send sites. */
const KNOWN_CORE_SEND = '"Browser.setDefaultViewport"';

/** Context options that would send a guarded command. */
const GUARDED_OPTIONS: readonly string[] = ['httpCredentials'];

const MODULE_RE = /\.[cm]?ts$/u;
const TEST_MODULE_RE = /\.test\.[cm]?ts$/u;

/** Where a guard looks for the use that would make its delta harmful. */
type GuardScope = 'src' | 'playwright-core';

/** The premise of one acceptance. */
interface IGuard {
  readonly scope: GuardScope;
  readonly patterns: readonly RegExp[];
}

/** A file and its text. */
interface ISource {
  readonly rel: string;
  readonly text: string;
}

/** The manifest fields that identify one accepted delta. */
interface IAcceptedDelta {
  readonly channel: string;
  readonly kind: string;
  readonly path: string;
}

const CREDENTIALS: IGuard = {
  scope: 'src',
  patterns: [/\bhttpCredentials\b/u, /\bsetHTTPCredentials\b/u],
};
const SCREENCAST_OPTIONS: IGuard = {
  scope: 'playwright-core',
  patterns: [/\bsetScreencastOptions\b/u],
};

/** Each accepted delta, as `channel kind path`, and the guard on its premise. */
const GUARDS: Readonly<Record<string, IGuard>> = {
  'request TYPE-MISMATCH Browser.setHTTPCredentials.credentials': CREDENTIALS,
  'request MISSING-METHOD Browser.setScreencastOptions': SCREENCAST_OPTIONS,
};
const SRC_GUARDS = Object.values(GUARDS).filter(guard => guard.scope === 'src');
const SRC_PATTERNS = [...new Set(SRC_GUARDS.flatMap(guard => guard.patterns))];

/** Planted uses; each must be flagged, and together they hit every src pattern. */
const PLANTED: readonly string[] = [
  "await browser.newContext({ httpCredentials: { username: 'u', password: 'p' } });",
  "await context.setHTTPCredentials({ username: 'u', password: 'p' });",
];

/** Builder options, then a statement that reaches them. */
const BUILT = 'const opts = buildContextOptions();\n';

/** What a planted context snippet sees: the builders and typed browsers, no context. */
const PRELUDE = [
  "import type { Browser, BrowserContext, BrowserType } from 'playwright-core';",
  "import { buildContextOptions } from './Common/Browser.js';",
  "import { buildContextOptions as buildSessionOptions } from './Scrapers/Pipeline/Mediator/Browser/BrowserContextBuilder.js';",
  'declare const browser: Browser;',
  'declare const camoufoxBrowser: Browser;',
  'declare const chromium: BrowserType;',
  'declare const options: { readonly browserContext: BrowserContext };',
  '',
].join('\n');

/** Context creation src must not do: options not from a builder, or none at all. */
const UNBUILT_CONTEXTS: readonly string[] = [
  'await browser.newContext({ viewport: { width: 1, height: 1 } });',
  'await browser.newContext();',
  'await browser.newContext(/* none */);',
  'const opts = { locale };\nawait browser.newContext(opts);',
  'let opts = buildContextOptions();\nawait browser.newContext(opts);',
  `${BUILT}opts.viewport = { width: 1, height: 1 };\nawait browser.newContext(opts);`,
  `${BUILT}delete opts.viewport;\nawait browser.newContext(opts);`,
  `${BUILT}const alias = opts;\nalias.isMobile = true;\nawait browser.newContext(opts);`,
  `${BUILT}const open = (opts: object) => browser.newContext(opts);`,
  `${BUILT}{\n  const opts = { isMobile: true };\n  await browser.newContext(opts);\n}`,
  `${BUILT}await browser.newContext({ ...opts, isMobile: true });`,
  `${BUILT}await browser.newContext(opts, extra);`,
  [
    'function open() {',
    '  function buildContextOptions() {',
    '    return { viewport: { width: 1, height: 1 } };',
    '  }',
    '  const opts = buildContextOptions();',
    '  return browser.newContext(opts);',
    '}',
  ].join('\n'),
  [
    'const opts = { isMobile: true };',
    'function open() {',
    '  {',
    '    const opts = buildContextOptions();',
    '  }',
    '  return browser.newContext(opts);',
    '}',
  ].join('\n'),
  'export const opts = buildContextOptions();\nawait browser.newContext(opts);',
  'await browser /* c */ .newContext /* c */ ({ isMobile: true });',
  "await browser['newContext']({ isMobile: true });",
  'const open = browser.newContext;',
  'const { newContext } = browser;',
  'await browser.newPage();',
  'await this.browser.newPage();',
  'await camoufoxBrowser.newPage();',
  'const context = browser;\nawait context.newPage();',
  'const browserContext = browser;\nawait browserContext.newPage();',
  "await chromium.launchPersistentContext('dir');",
];

/** Code that uses none of the guarded features. */
const CLEAN = [
  "const contextOpts = buildSessionOptions('state.json');",
  'const context = await browser.newContext(contextOpts);',
  'const multi = buildContextOptions();',
  'const second = await browser.newContext(\n  multi,\n);',
  'const page = await context.newPage();',
  'await second.newPage();',
  'await options.browserContext.newPage();',
  'function open(held: BrowserContext) {\n  return held.newPage();\n}',
  "type Context = Awaited<ReturnType<Browser['newContext']>>;",
  'const snapshot = { viewport: { width: 0, height: 0 } };',
  "await page.screenshot({ path: 'a.png' });",
].join('\n');

/**
 * Every file under a directory that a filter keeps, skipping `src/Tests`.
 *
 * @param dir - Absolute directory.
 * @param isKept - Which files to keep.
 * @returns Absolute paths.
 */
function walk(dir: string, isKept: (file: string) => boolean): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry: fs.Dirent): string[] => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return full === TESTS_DIR ? [] : walk(full, isKept);
    return isKept(full) ? [full] : [];
  });
}

/**
 * Read files as sources.
 *
 * @param files - Absolute paths.
 * @returns Each file, repo-relative, with its text.
 */
function readSources(files: readonly string[]): ISource[] {
  return files.map((file: string): ISource => {
    const text = fs.readFileSync(file, 'utf8');
    return { rel: path.relative(REPO_ROOT, file), text };
  });
}

/**
 * Where sources match any of some patterns.
 *
 * @param sources - The sources to scan.
 * @param patterns - Non-global patterns.
 * @returns One `file: pattern` finding per match.
 */
function usageFindings(sources: readonly ISource[], patterns: readonly RegExp[]): string[] {
  return sources.flatMap((source: ISource): string[] => {
    const hits = patterns.filter(pattern => pattern.test(source.text));
    return hits.map(pattern => `${source.rel}: ${pattern.source}`);
  });
}

/**
 * Whether a file is a TypeScript module that is not a test.
 *
 * @param file - A path.
 * @returns True for `.ts`, `.mts` and `.cts`, except `*.test.*`.
 */
function isSrcModule(file: string): boolean {
  return MODULE_RE.test(file) && !TEST_MODULE_RE.test(file);
}

/**
 * A snippet as a typed module beside the real src, so its names resolve.
 *
 * @param name - A file name for the snippet.
 * @param snippet - The planted code.
 * @returns The in-memory file.
 */
function plantedFile(name: string, snippet: string): IMemoryFile {
  return { path: path.join(SRC_DIR, `${name}.ts`), text: `${PRELUDE}${snippet}` };
}

/**
 * A planted snippet as a source, for the usage patterns.
 *
 * @param text - The snippet.
 * @returns The source.
 */
function planted(text: string): ISource {
  return { rel: 'planted.ts', text };
}

/**
 * The src files that name a context-creating member, as in-memory files.
 *
 * @param sources - Every src module.
 * @returns The files the context guard checks.
 */
function contextFiles(sources: readonly ISource[]): IMemoryFile[] {
  const named = sources.filter(source => CONTEXT_NAME_RE.test(source.text));
  return named.map(source => ({ path: path.join(REPO_ROOT, source.rel), text: source.text }));
}

/**
 * One program over the context-creating src and every planted context snippet.
 *
 * @param files - The real and planted files.
 * @returns The program to check, rooted at the repo.
 */
function contextProgram(files: readonly IMemoryFile[]): IContextProgram {
  const options = repoCompilerOptions(REPO_ROOT);
  const program = programOf(files, options);
  return { program, root: REPO_ROOT };
}

/**
 * The manifest's accepted deltas, as `channel kind path`.
 *
 * @returns One key per accepted delta.
 */
function acceptedKeys(): string[] {
  const text = fs.readFileSync(MANIFEST, 'utf8');
  const manifest = JSON.parse(text) as { readonly acceptedDeltas: readonly IAcceptedDelta[] };
  return manifest.acceptedDeltas.map(delta => `${delta.channel} ${delta.kind} ${delta.path}`);
}

describe('browser-stack acceptance guards', () => {
  const srcFiles = walk(SRC_DIR, isSrcModule);
  const srcSources = readSources(srcFiles);
  const realContextFiles = contextFiles(srcSources);
  const unbuiltFiles = UNBUILT_CONTEXTS.map((snippet, index) => {
    const name = `BsgUnbuilt${String(index)}`;
    return plantedFile(name, snippet);
  });
  const unbuiltCases = UNBUILT_CONTEXTS.map((snippet, index): [string, IMemoryFile] => {
    return [snippet, unbuiltFiles[index]];
  });
  const cleanFile = plantedFile('BsgClean', CLEAN);
  const scan = contextProgram([...realContextFiles, ...unbuiltFiles, cleanFile]);

  it('[BSG-1] every accepted delta has exactly one guard, and every guard a delta', () => {
    const accepted = acceptedKeys().sort();
    const guarded = Object.keys(GUARDS).sort();
    expect(accepted).toEqual(guarded);
  });

  it('[BSG-2] no usage guard matches non-test src', () => {
    const relative = srcSources.map(source => source.rel);
    const findings = usageFindings(srcSources, SRC_PATTERNS);
    const builder = path.join('src', 'Common', 'Browser.ts');
    expect(relative).toContain(builder);
    expect(srcSources.length).toBeGreaterThan(100);
    expect(findings).toEqual([]);
  });

  it.each([
    ['src/Common/Browser.ts', commonContextOptions()],
    ['BrowserContextBuilder, cold', pipelineContextOptions()],
    ['BrowserContextBuilder, saved session', pipelineContextOptions('state.json')],
  ])('[BSG-3] %s sets no guarded option', (_name, options) => {
    const keys = Object.keys(options);
    const guarded = keys.filter(key => GUARDED_OPTIONS.includes(key));
    expect(guarded).toEqual([]);
  });

  it('[BSG-4] every context src creates takes its options from a builder', () => {
    const findings = realContextFiles.flatMap(file => contextFindings(scan, file.path));
    const builtCalls = realContextFiles.map(file => builtContextCount(scan, file.path));
    const total = builtCalls.reduce((sum, count) => sum + count, 0);
    expect(total).toBeGreaterThan(0);
    expect(findings).toEqual([]);
  });

  it.each([
    ['a.ts', true],
    ['a.mts', true],
    ['a.cts', true],
    ['a.d.ts', true],
    ['a.test.ts', false],
    ['a.test.mts', false],
    ['a.js', false],
  ])('[BSG-4] scans %s: %s', (file, isScanned) => {
    const isKept = isSrcModule(file);
    expect(isKept).toBe(isScanned);
  });

  it('[BSG-5] playwright-core still never sends a method Camoufox lacks', () => {
    const coreFiles = walk(CORE_LIB_DIR, file => file.endsWith('.js'));
    const coreSources = readSources(coreFiles);
    const hasKnownSend = coreSources.some(source => source.text.includes(KNOWN_CORE_SEND));
    const findings = usageFindings(coreSources, SCREENCAST_OPTIONS.patterns);
    expect(hasKnownSend).toBe(true);
    expect(findings).toEqual([]);
  });

  it.each(PLANTED)('[BSG-6] flags the planted use %s', snippet => {
    const source = planted(snippet);
    const findings = usageFindings([source], SRC_PATTERNS);
    expect(findings).not.toEqual([]);
  });

  it('[BSG-6] every src pattern flags some planted use', () => {
    const plantedSources = PLANTED.map(planted);
    const dead = SRC_PATTERNS.filter(pattern => {
      const hits = usageFindings(plantedSources, [pattern]);
      return hits.length === 0;
    });
    expect(dead).toEqual([]);
  });

  it.each(unbuiltCases)('[BSG-6] flags the unbuilt context %s', (_snippet, file) => {
    const findings = contextFindings(scan, file.path);
    expect(findings).not.toEqual([]);
  });

  it('[BSG-6] passes clean code', () => {
    const source = planted(CLEAN);
    const usage = usageFindings([source], SRC_PATTERNS);
    const contexts = contextFindings(scan, cleanFile.path);
    const built = builtContextCount(scan, cleanFile.path);
    expect(usage).toEqual([]);
    expect(contexts).toEqual([]);
    expect(built).toBe(2);
  });
});
