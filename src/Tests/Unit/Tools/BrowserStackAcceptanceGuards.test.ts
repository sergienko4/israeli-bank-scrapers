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
 *   BSG-4  every context src creates takes its options from a builder: by
 *          syntax, each newContext gets an untouched builder const, each
 *          newPage runs on a context, and no persistent context exists
 *   BSG-5  playwright-core still never sends a method Camoufox lacks
 *   BSG-6  the test that pins the screenshot as best-effort still exists
 *   BSG-7  each pattern flags a planted use and passes clean code
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as ts from 'typescript';

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

const CONTEXT_BUILDER = 'buildContextOptions';
/** Names that create a context; a source naming none of them needs no parse. */
const CONTEXT_NAME_RE = /newContext|newPage|launchPersistentContext/u;
/** A receiver named as a context; `newPage` on anything else opens a default context. */
const CONTEXT_RECEIVER_RE = /context$/iu;
const MODULE_RE = /\.[cm]?ts$/u;
const TEST_MODULE_RE = /\.test\.[cm]?ts$/u;

/** Whether one mention of a context-creating name is safe. */
type MentionRule = (mention: ts.Node, tree: ts.SourceFile) => boolean;

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

/** Builder options, then a statement that reaches them. */
const BUILT = 'const opts = buildContextOptions();\n';

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
  'await browser /* c */ .newContext /* c */ ({ isMobile: true });',
  "await browser['newContext']({ isMobile: true });",
  'const open = browser.newContext;',
  'const { newContext } = browser;',
  'await browser.newPage();',
  'await this.browser.newPage();',
  'await camoufoxBrowser.newPage();',
  "await chromium.launchPersistentContext('dir');",
];

/** Code that uses none of the guarded features. */
const CLEAN = [
  'const contextOpts = buildContextOptions(saved);',
  'const context = await browser.newContext(contextOpts);',
  'const multi = buildContextOptions();',
  'const second = await browser.newContext(\n  multi,\n);',
  'const page = await context.newPage();',
  'await this.options.browserContext.newPage();',
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
 * Parse a source as TypeScript, with parent links.
 *
 * @param source - The source.
 * @returns Its syntax tree.
 */
function parseSource(source: ISource): ts.SourceFile {
  const { rel, text } = source;
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * A node and every code node under it; JSDoc is not code.
 *
 * @param node - Where to start.
 * @param tree - The tree the node belongs to.
 * @returns The nodes, outermost first.
 */
function codeNodes(node: ts.Node, tree: ts.SourceFile): ts.Node[] {
  const children = node.getChildren(tree).filter(child => !ts.isJSDoc(child));
  const nested = children.flatMap((child: ts.Node): ts.Node[] => codeNodes(child, tree));
  return [node, ...nested];
}

/**
 * Whether a node sits in a type, where a name is not a call.
 *
 * @param node - A syntax node.
 * @returns True under a type node.
 */
function isInType(node: ts.Node): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return false;
  return ts.isTypeNode(parent) || isInType(parent);
}

/**
 * The name a code node spells: an identifier or a string key.
 *
 * @param node - A syntax node.
 * @returns The name, or '' for any other node and for names in types.
 */
function mentionName(node: ts.Node): string {
  const isName = ts.isIdentifier(node) || ts.isStringLiteralLike(node);
  return isName && !isInType(node) ? node.text : '';
}

/**
 * The call that invokes a mention as a member: `x.name(…)` or `x['name'](…)`.
 *
 * @param mention - A name node.
 * @returns That call, or none when the name is used any other way.
 */
function calleeOf(mention: ts.Node): ts.CallExpression[] {
  const access = mention.parent;
  const isProperty = ts.isPropertyAccessExpression(access) && access.name === mention;
  const isElement = ts.isElementAccessExpression(access) && access.argumentExpression === mention;
  const call = access.parent;
  const isCall = ts.isCallExpression(call) && call.expression === access;
  return (isProperty || isElement) && isCall ? [call] : [];
}

/**
 * The last name of a member call's receiver: `context` for `this.context.newPage()`.
 *
 * @param call - A member call.
 * @returns The name, or '' when the receiver is not a plain name.
 */
function receiverName(call: ts.CallExpression): string {
  const callee = call.expression;
  const isMember = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee);
  const receiver = isMember ? callee.expression : callee;
  if (ts.isIdentifier(receiver)) return receiver.text;
  return ts.isPropertyAccessExpression(receiver) ? receiver.name.text : '';
}

/**
 * Whether a declaration's initializer is a direct builder call.
 *
 * @param declaration - A variable declaration.
 * @returns True for `<name> = buildContextOptions(…)`.
 */
function isBuilderCall(declaration: ts.VariableDeclaration): boolean {
  const value = declaration.initializer;
  if (!value || !ts.isCallExpression(value)) return false;
  const callee = value.expression;
  return ts.isIdentifier(callee) && callee.text === CONTEXT_BUILDER;
}

/**
 * Whether an identifier declares a `const` set straight from the builder.
 *
 * @param name - An identifier.
 * @returns True for `const <name> = buildContextOptions(…)`.
 */
function isBuiltConst(name: ts.Node): boolean {
  const declaration = name.parent;
  if (!ts.isVariableDeclaration(declaration) || declaration.name !== name) return false;
  const keyword = declaration.parent.getFirstToken();
  const isConst = keyword?.kind === ts.SyntaxKind.ConstKeyword;
  return isConst && isBuilderCall(declaration);
}

/**
 * The nearest function or file around a node: where its name must be declared.
 *
 * @param node - A syntax node.
 * @returns The scope node.
 */
function scopeOf(node: ts.Node): ts.Node {
  const parent = node.parent;
  return ts.isFunctionLike(parent) || ts.isSourceFile(parent) ? parent : scopeOf(parent);
}

/**
 * Whether an argument is a builder `const` of its scope that nothing else touches.
 * Exactly two uses, the declaration and this argument, rule out a later
 * write, a `delete`, an alias and a shadowing name.
 *
 * @param arg - The `newContext` argument.
 * @param tree - Its tree.
 * @returns True when the options reach `newContext` as built.
 */
function isUntouchedBuild(arg: ts.Identifier, tree: ts.SourceFile): boolean {
  const scope = scopeOf(arg);
  const uses = codeNodes(scope, tree).filter(node => mentionName(node) === arg.text);
  const isDeclared = uses.some(isBuiltConst);
  return uses.length === 2 && isDeclared;
}

/**
 * Whether a call passes one argument, an untouched builder result.
 *
 * @param call - A `newContext` call.
 * @param tree - Its tree.
 * @returns True for `newContext(<untouched builder const>)`.
 */
function isBuiltCall(call: ts.CallExpression, tree: ts.SourceFile): boolean {
  const [arg] = call.arguments;
  const isSole = call.arguments.length === 1 && ts.isIdentifier(arg);
  return isSole && isUntouchedBuild(arg, tree);
}

/**
 * Whether a `newContext` mention is a call with untouched builder options.
 *
 * @param mention - A `newContext` name node.
 * @param tree - Its tree.
 * @returns True for `x.newContext(<untouched builder const>)`.
 */
function isBuiltContext(mention: ts.Node, tree: ts.SourceFile): boolean {
  const calls = calleeOf(mention);
  return calls.some(call => isBuiltCall(call, tree));
}

/**
 * Whether a `newPage` mention is a call on a context.
 *
 * @param mention - A `newPage` name node.
 * @returns True for `context.newPage()`.
 */
function isContextPage(mention: ts.Node): boolean {
  const calls = calleeOf(mention);
  return calls.some(isOnContext);
}

/**
 * A persistent context never takes builder options.
 *
 * @returns False.
 */
function isNeverSafe(): boolean {
  return false;
}

/**
 * Whether a member call's receiver is named as a context.
 *
 * @param call - A member call.
 * @returns True for `context.newPage()` and `this.options.browserContext.newPage()`.
 */
function isOnContext(call: ts.CallExpression): boolean {
  const name = receiverName(call);
  return CONTEXT_RECEIVER_RE.test(name);
}

/** Per context-creating name: when one mention of it is safe. */
const MENTION_RULES: Readonly<Record<string, MentionRule>> = {
  newContext: isBuiltContext,
  newPage: isContextPage,
  launchPersistentContext: isNeverSafe,
};

/**
 * Whether a node names a context-creating member in an unsafe way.
 *
 * @param node - A syntax node.
 * @param tree - Its tree.
 * @returns True for a mention its rule rejects.
 */
function isUnsafeMention(node: ts.Node, tree: ts.SourceFile): boolean {
  const name = mentionName(node);
  if (!Object.hasOwn(MENTION_RULES, name)) return false;
  return !MENTION_RULES[name](node, tree);
}

/**
 * One finding: where a node is, and its text.
 *
 * @param node - The unsafe mention.
 * @param tree - Its tree.
 * @returns `file:line name`.
 */
function findingAt(node: ts.Node, tree: ts.SourceFile): string {
  const start = node.getStart(tree);
  const { line } = tree.getLineAndCharacterOfPosition(start);
  return `${tree.fileName}:${String(line + 1)} ${node.getText(tree)}`;
}

/**
 * Where a source creates a context whose options do not come from a builder.
 *
 * @param source - The source to scan.
 * @returns One `file:line name` finding per unsafe mention.
 */
function contextFindings(source: ISource): string[] {
  if (!CONTEXT_NAME_RE.test(source.text)) return [];
  const tree = parseSource(source);
  const unsafe = codeNodes(tree, tree).filter(node => isUnsafeMention(node, tree));
  return unsafe.map(node => findingAt(node, tree));
}

/**
 * How many `newContext` calls a source makes with untouched builder options.
 *
 * @param source - The source to scan.
 * @returns The count.
 */
function builtContextCount(source: ISource): number {
  if (!source.text.includes('newContext')) return 0;
  const tree = parseSource(source);
  const mentions = codeNodes(tree, tree).filter(node => mentionName(node) === 'newContext');
  return mentions.filter(mention => MENTION_RULES.newContext(mention, tree)).length;
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
  const srcFiles = walk(SRC_DIR, isSrcModule);
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
    const builtCalls = srcSources.map(builtContextCount);
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
