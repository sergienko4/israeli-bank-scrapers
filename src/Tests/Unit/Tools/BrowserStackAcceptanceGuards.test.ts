/**
 * Browser-stack acceptance guards.
 *
 * <p>`browser-stack.json` accepts Juggler deltas that break only a feature
 * this package does not use: a fixed viewport, HTTP credentials, screencast,
 * WebSocket frames. The gate that reads the manifest runs only when the
 * browser stack moves, so a src-only change could start using one of them
 * and leave a now-harmful delta accepted. This suite runs with the unit tests
 * on every src change and checks the premise of each acceptance.
 *
 * Rules:
 *   BSG-1  every accepted delta has exactly one guard, and every guard a delta
 *   BSG-2  no usage guard matches non-test src
 *   BSG-3  both context builders keep the viewport null and set no option
 *          that sends a guarded command
 *   BSG-4  every context src creates takes its options from a builder
 *   BSG-5  playwright-core still never sends a method Camoufox lacks
 *   BSG-6  the test that pins the screenshot as best-effort still exists
 *   BSG-7  each pattern flags a planted use and passes clean code
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildContextOptions as commonContextOptions } from '../../../Common/Browser.js';
import { buildContextOptions as pipelineContextOptions } from '../../../Scrapers/Pipeline/Mediator/Browser/BrowserContextBuilder.js';

const REPO_ROOT = process.cwd();
const SRC_DIR = path.join(REPO_ROOT, 'src');
const TESTS_DIR = path.join(SRC_DIR, 'Tests');
const CORE_LIB_DIR = path.join(REPO_ROOT, 'node_modules', 'playwright-core', 'lib');
const MANIFEST = path.join(REPO_ROOT, 'browser-stack.json');
const SCREENSHOT_PIN = path.join(TESTS_DIR, 'Unit', 'Common', 'SafeScreenshot.test.ts');
const SCREENSHOT_PIN_TITLE = 'safeScreenshot — swallows capture errors';

/** A Juggler send playwright-core makes, proving the core scan reads its send sites. */
const KNOWN_CORE_SEND = '"Browser.setDefaultViewport"';

/** Context options that would send a guarded command. */
const GUARDED_OPTIONS: readonly string[] = [
  'screen',
  'isMobile',
  'deviceScaleFactor',
  'httpCredentials',
  'recordVideo',
];

/** A `newContext(…)` call and its argument text. */
const NEW_CONTEXT_RE = /\.newContext\((?<arg>[^)]*)\)/gu;
/** A context src would create without options: a browser-level page or a persistent context. */
const DEFAULT_CONTEXT_RE = /\bbrowser\.newPage\(|\blaunchPersistentContext\b/u;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/u;

/** Where a guard looks for the use that would make its delta harmful. */
type GuardScope = 'src' | 'playwright-core' | 'consumer';

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

/** Viewport emulation: the page call, its options and device descriptors. */
const VIEWPORT: IGuard = {
  scope: 'src',
  patterns: [
    /\bsetViewportSize\b/u,
    /\bisMobile\b/u,
    /\bscreenSize\b/u,
    /\bdeviceScaleFactor\b/u,
    /\bdevices\s*\[/u,
  ],
};
const CREDENTIALS: IGuard = {
  scope: 'src',
  patterns: [/\bhttpCredentials\b/u, /\bsetHTTPCredentials\b/u],
};
const SCREENCAST: IGuard = { scope: 'src', patterns: [/\brecordVideo\b/u, /screencast/iu] };
const WEBSOCKET: IGuard = { scope: 'src', patterns: [/websocket/iu] };
const SCREENCAST_OPTIONS: IGuard = {
  scope: 'playwright-core',
  patterns: [/\bsetScreencastOptions\b/u],
};
/** A consumer's `.webp` screenshot path; the capture is best-effort (BSG-6). */
const WEBP_SCREENSHOT: IGuard = { scope: 'consumer', patterns: [] };

/** Each accepted delta, as `channel kind path`, and the guard on its premise. */
const GUARDS: Readonly<Record<string, IGuard>> = {
  'request UNKNOWN-FIELD Browser.setDefaultViewport.viewport.isMobile': VIEWPORT,
  'request UNKNOWN-FIELD Browser.setDefaultViewport.viewport.screenSize': VIEWPORT,
  'request TYPE-MISMATCH Browser.setHTTPCredentials.credentials': CREDENTIALS,
  'request MISSING-METHOD Browser.setScreencastOptions': SCREENCAST_OPTIONS,
  'request MISSING-REQUIRED-FIELD Page.screencastFrameAck.screencastId': SCREENCAST,
  'request ENUM-VALUE Page.screenshot.mimeType="image/webp"': WEBP_SCREENSHOT,
  'request UNKNOWN-FIELD Page.setViewportSize.deviceScaleFactor': VIEWPORT,
  'request UNKNOWN-FIELD Page.setViewportSize.isMobile': VIEWPORT,
  'request UNKNOWN-FIELD Page.setViewportSize.screenSize': VIEWPORT,
  'event MISSING-REQUIRED-FIELD Page.screencastFrame.timestamp': SCREENCAST,
  'event MISSING-REQUIRED-FIELD Page.webSocketFrameReceived.timestamp': WEBSOCKET,
  'event MISSING-REQUIRED-FIELD Page.webSocketFrameSent.timestamp': WEBSOCKET,
};
const SRC_GUARDS = Object.values(GUARDS).filter(guard => guard.scope === 'src');
const SRC_PATTERNS = [...new Set(SRC_GUARDS.flatMap(guard => guard.patterns))];

/** Planted uses; each must be flagged, and together they hit every src pattern. */
const PLANTED: readonly string[] = [
  'await page.setViewportSize({ width: 1, height: 1 });',
  'const options = { isMobile: true };',
  'const screenSize = { width: 1, height: 1 };',
  'const options = { deviceScaleFactor: 2 };',
  "const phone = devices['Pixel 5'];",
  "await browser.newContext({ httpCredentials: { username: 'u', password: 'p' } });",
  "await context.setHTTPCredentials({ username: 'u', password: 'p' });",
  "await browser.newContext({ recordVideo: { dir: 'v' } });",
  'await page.screencast.start();',
  "page.on('websocket', socket => socket.url());",
  "await page.routeWebSocket('wss://x', socket => socket.close());",
];

/** Context creation src must not do: options not from a builder, or none at all. */
const UNBUILT_CONTEXTS: readonly string[] = [
  'await browser.newContext({ viewport: { width: 1, height: 1 } });',
  'await browser.newContext();',
  'const opts = { locale };\nawait browser.newContext(opts);',
  'await browser.newPage();',
  "await chromium.launchPersistentContext('dir');",
];

/** Code that uses none of the guarded features. */
const CLEAN = [
  'const contextOpts = buildContextOptions(saved);',
  'const context = await browser.newContext(contextOpts);',
  'const page = await context.newPage();',
  'await this.options.browserContext.newPage();',
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
 * Whether a `newContext` argument is a builder result declared in the same file.
 *
 * @param text - The file.
 * @param arg - The argument text, untrimmed.
 * @returns True for `const <arg> = buildContextOptions(…)`.
 */
function isBuilt(text: string, arg: string): boolean {
  const name = arg.trim();
  const isIdentifier = IDENTIFIER_RE.test(name);
  return isIdentifier && text.includes(`const ${name} = buildContextOptions(`);
}

/**
 * Where a source creates a context whose options do not come from a builder.
 *
 * @param source - The source to scan.
 * @returns One finding per such context.
 */
function contextFindings(source: ISource): string[] {
  const calls = [...source.text.matchAll(NEW_CONTEXT_RE)];
  const unbuilt = calls.filter(call => !isBuilt(source.text, call.groups?.arg ?? ''));
  const hits = unbuilt.map(call => `${source.rel}: ${call[0]}`);
  const isDefault = DEFAULT_CONTEXT_RE.test(source.text);
  return isDefault ? [...hits, `${source.rel}: a context with default options`] : hits;
}

/**
 * A planted snippet as a source.
 *
 * @param text - The snippet.
 * @returns The source.
 */
function planted(text: string): ISource {
  return { rel: 'planted.ts', text };
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
  const srcFiles = walk(SRC_DIR, file => file.endsWith('.ts') && !file.endsWith('.test.ts'));
  const srcSources = readSources(srcFiles);

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
  ])('[BSG-3] %s keeps the viewport null and sets no guarded option', (_name, options) => {
    const keys = Object.keys(options);
    const guarded = keys.filter(key => GUARDED_OPTIONS.includes(key));
    expect(options.viewport).toBeNull();
    expect(guarded).toEqual([]);
  });

  it('[BSG-4] every context src creates takes its options from a builder', () => {
    const findings = srcSources.flatMap(contextFindings);
    const builtCalls = srcSources.filter(source => source.text.includes('.newContext('));
    expect(builtCalls.length).toBeGreaterThan(0);
    expect(findings).toEqual([]);
  });

  it('[BSG-5] playwright-core still never sends a method Camoufox lacks', () => {
    const coreFiles = walk(CORE_LIB_DIR, file => file.endsWith('.js'));
    const coreSources = readSources(coreFiles);
    const hasKnownSend = coreSources.some(source => source.text.includes(KNOWN_CORE_SEND));
    const findings = usageFindings(coreSources, SCREENCAST_OPTIONS.patterns);
    expect(hasKnownSend).toBe(true);
    expect(findings).toEqual([]);
  });

  it('[BSG-6] the test that pins the screenshot as best-effort still exists', () => {
    const pin = fs.readFileSync(SCREENSHOT_PIN, 'utf8');
    expect(pin).toContain(SCREENSHOT_PIN_TITLE);
  });

  it.each(PLANTED)('[BSG-7] flags the planted use %s', snippet => {
    const source = planted(snippet);
    const findings = usageFindings([source], SRC_PATTERNS);
    expect(findings).not.toEqual([]);
  });

  it('[BSG-7] every src pattern flags some planted use', () => {
    const plantedSources = PLANTED.map(planted);
    const dead = SRC_PATTERNS.filter(pattern => {
      const hits = usageFindings(plantedSources, [pattern]);
      return hits.length === 0;
    });
    expect(dead).toEqual([]);
  });

  it.each(UNBUILT_CONTEXTS)('[BSG-7] flags the unbuilt context %s', snippet => {
    const source = planted(snippet);
    const findings = contextFindings(source);
    expect(findings).not.toEqual([]);
  });

  it('[BSG-7] passes clean code', () => {
    const source = planted(CLEAN);
    const usage = usageFindings([source], SRC_PATTERNS);
    const contexts = contextFindings(source);
    expect(usage).toEqual([]);
    expect(contexts).toEqual([]);
  });
});
