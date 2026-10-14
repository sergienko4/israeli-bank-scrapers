/**
 * Spawn status checked — every `spawnSync` result has its exit status read.
 *
 * <p>`spawnSync` never throws for a child that fails: a missing binary, a
 * crash, a non-zero exit or a timeout kill all come back as a result whose
 * output may look fine. A caller that reads only `stdout` treats any of
 * those as success, so a test can pass on a child that never did its job,
 * and a test that uses a child's output as its oracle can quietly turn
 * vacuous. Every tracked script and TypeScript file is parsed, and each
 * `spawnSync` result must have `status` read: off the call itself, from a
 * destructured `status`, or off the variable holding it, anywhere in the
 * function that declares that variable.
 */

import * as ts from 'typescript';

import { readRepoFile, trackedFiles } from '../../../Helpers/RepoFiles.js';

/** A TypeScript or JavaScript source file. */
const CODE_FILE_RE = /\.[cm]?[jt]s$/u;
/** Files known to run `spawnSync`, from the tests and from the scripts. */
const KNOWN_SPAWNERS = [
  'src/Tests/Unit/Pipeline/CrossValidation/CriticalDepsFullSuiteGate.test.ts',
  'scripts/check-jest-scopes.mjs',
] as const;
/** Fewer sites than this means the scan stopped seeing them. */
const MIN_SITES = 20;

/** One `spawnSync` call and whether its status is read. */
interface ISpawnSite {
  readonly site: string;
  readonly isChecked: boolean;
}

/**
 * Whether a node calls `spawnSync`, bare or off a namespace.
 *
 * @param node - Any node.
 * @returns True for a `spawnSync(…)` call.
 */
function isSpawnSyncCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  return ts.isIdentifier(name) && name.text === 'spawnSync';
}

/**
 * Every `spawnSync` call in a subtree.
 *
 * @param node - Subtree root.
 * @param source - Its source file.
 * @returns The calls, in source order.
 */
function spawnCalls(node: ts.Node, source: ts.SourceFile): readonly ts.CallExpression[] {
  const own = isSpawnSyncCall(node) ? [node] : [];
  const children = node.getChildren(source);
  const nested = children.flatMap(child => spawnCalls(child, source));
  return [...own, ...nested];
}

/**
 * Whether any node in a subtree passes a test.
 *
 * @param node - Subtree root.
 * @param source - Its source file.
 * @param test - The test.
 * @returns True when one does.
 */
function someNode(node: ts.Node, source: ts.SourceFile, test: (n: ts.Node) => boolean): boolean {
  if (test(node)) return true;
  const children = node.getChildren(source);
  return children.some(child => someNode(child, source, test));
}

/**
 * The function (or file) whose body declares a node.
 *
 * @param node - A node below a function or file.
 * @returns The nearest enclosing function-like node or the source file.
 */
function scopeOf(node: ts.Node): ts.Node {
  const parent = node.parent;
  if (ts.isFunctionLike(parent) || ts.isSourceFile(parent)) return parent;
  return scopeOf(parent);
}

/**
 * Whether a destructuring takes `status`.
 *
 * @param binding - An object binding pattern.
 * @returns True when one element binds `status`.
 */
function bindsStatus(binding: ts.ObjectBindingPattern): boolean {
  return binding.elements.some(element => {
    const key = element.propertyName ?? element.name;
    return ts.isIdentifier(key) && key.text === 'status';
  });
}

/**
 * Whether a node reads `status` off a named variable.
 *
 * @param node - Any node.
 * @param name - The variable.
 * @returns True for `name.status`.
 */
function readsStatusOf(node: ts.Node, name: string): boolean {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'status') return false;
  return ts.isIdentifier(node.expression) && node.expression.text === name;
}

/**
 * Whether a `spawnSync` call's result has its status read.
 *
 * @param call - The call.
 * @param source - Its source file.
 * @returns True when checked.
 */
function isStatusRead(call: ts.CallExpression, source: ts.SourceFile): boolean {
  const parent = call.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name.text === 'status';
  if (!ts.isVariableDeclaration(parent)) return false;
  if (ts.isObjectBindingPattern(parent.name)) return bindsStatus(parent.name);
  const name = parent.name.getText(source);
  const scope = scopeOf(parent);
  return someNode(scope, source, node => readsStatusOf(node, name));
}

/**
 * Every `spawnSync` call in one file.
 *
 * @param path - The file's name, used in each site.
 * @param text - Its source.
 * @returns One entry per call, named `path:line`.
 */
function sitesIn(path: string, text: string): readonly ISpawnSite[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const calls = spawnCalls(source, source);
  return calls.map(call => {
    const start = call.getStart(source);
    const { line } = source.getLineAndCharacterOfPosition(start);
    return { site: `${path}:${String(line + 1)}`, isChecked: isStatusRead(call, source) };
  });
}

/**
 * Every `spawnSync` call in the tracked code.
 *
 * @returns One entry per call.
 */
function repoSites(): readonly ISpawnSite[] {
  const paths = trackedFiles();
  const code = paths.filter(path => CODE_FILE_RE.test(path));
  const texts = code.map(path => ({ path, text: readRepoFile(path) }));
  const spawning = texts.filter(file => file.text.includes('spawnSync'));
  return spawning.flatMap(file => sitesIn(file.path, file.text));
}

const SITES = repoSites();

/** Calls whose status is never read. */
const UNCHECKED: readonly (readonly [string, string])[] = [
  ['output read, status never', "function f() { const r = spawnSync('x', []); return r.stdout; }"],
  ['another property read off the call', "function f() { return spawnSync('x', []).stdout; }"],
  ['a discarded result', "spawnSync('x', []);"],
  ['a result passed straight on', "log(spawnSync('x', []));"],
  ['a destructuring without status', "const { stdout } = spawnSync('x', []);"],
  [
    'status read only in another function',
    "function f() { const r = spawnSync('x', []); return r.stdout; }\n" +
      'function g(r: { status: number }) { return r.status; }',
  ],
];

/** Calls whose status is read. */
const CHECKED: readonly (readonly [string, string])[] = [
  [
    'a status check before the output',
    "function f() { const r = spawnSync('x', []); if (r.status !== 0) throw r.error; return r.stdout; }",
  ],
  ['status read off the call', "function f() { return spawnSync('x', []).status; }"],
  [
    'status returned with the output',
    "function f() { const r = spawnSync('x', []); return { status: r.status ?? -1, out: r.stdout }; }",
  ],
  ['a destructured status', "const { status, stdout } = spawnSync('x', []);"],
  ['a namespaced call', "function f() { const r = cp.spawnSync('x', []); return r.status; }"],
  [
    'status read in a closure',
    "function f() { const r = spawnSync('x', []); return () => r.status; }",
  ],
];

describe('Spawn status checked', () => {
  it('SSC-1: every spawnSync result in the tracked code has its status read', () => {
    const unchecked = SITES.filter(site => !site.isChecked).map(site => site.site);
    expect(unchecked).toEqual([]);
  });

  it('SSC-2: the scan sees the spawns in both the tests and the scripts', () => {
    const files = SITES.map(site => site.site.replace(/:\d+$/u, ''));
    const missing = KNOWN_SPAWNERS.filter(path => !files.includes(path));
    expect(missing).toEqual([]);
    expect(SITES.length).toBeGreaterThanOrEqual(MIN_SITES);
  });

  it.each(UNCHECKED)('SSC-3: flags %s', (_name, code) => {
    const sites = sitesIn('control.ts', code);
    const checked = sites.map(site => site.isChecked);
    expect(checked).toEqual([false]);
  });

  it.each(CHECKED)('SSC-4: accepts %s', (_name, code) => {
    const sites = sitesIn('control.ts', code);
    const checked = sites.map(site => site.isChecked);
    expect(checked).toEqual([true]);
  });
});
