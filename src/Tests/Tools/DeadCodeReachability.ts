/**
 * Symbol-level reachability for the dead-code gate. Files alone are too
 * coarse: a barrel re-export can keep a file "used" while none of its
 * exports are consumed. This module resolves named, namespace and
 * `export *` edges from the real entry points, then reports unreachable
 * files and unused local exports.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as ts from 'typescript';

import { resolveImport, UNRESOLVED, walkProdFiles } from './ImportGraphScan.js';

/** One import edge; `*` means the whole namespace is consumed. */
interface IImportEdge {
  readonly target: string;
  readonly names: readonly string[] | '*';
}

/** A named re-export (`export { A as B } from './x.js'`). */
interface INamedReexport {
  readonly exported: string;
  readonly target: string;
  readonly targetName: string;
}

/** A namespace re-export (`export * as ns from './x.js'`). */
interface INamespaceReexport {
  readonly exported: string;
  readonly target: string;
}

/** One module's parsed surface and outgoing edges. */
interface IModuleSource {
  readonly file: string;
  readonly local: readonly string[];
  readonly named: readonly INamedReexport[];
  readonly stars: readonly string[];
  readonly namespaces: readonly INamespaceReexport[];
  readonly imports: readonly IImportEdge[];
}

/** Mutable parser accumulator. */
interface IModuleDraft {
  readonly local: string[];
  readonly named: INamedReexport[];
  readonly stars: string[];
  readonly namespaces: INamespaceReexport[];
  readonly imports: IImportEdge[];
}

/** A resolved local export definition. */
interface IExportRef {
  readonly file: string;
  readonly name: string;
}

/** The dead items the gate evaluates. */
interface IDeadCodeReport {
  readonly files: readonly string[];
  readonly exports: readonly string[];
}

/** Committed baseline shape. */
interface IDeadCodeBaseline {
  readonly note: string;
  readonly unreachableFiles: readonly string[];
  readonly unusedExports: readonly string[];
}

/** Parser context for one source file. */
interface IParserContext {
  readonly root: string;
  readonly file: string;
  readonly draft: IModuleDraft;
}

/** Export resolver arguments. */
interface IResolveArgs {
  readonly graph: ModuleGraph;
  readonly file: string;
  readonly name: string;
  readonly seen: ReadonlySet<string>;
}

/** Export marker arguments. */
interface IMarkArgs {
  readonly graph: ModuleGraph;
  readonly used: Set<string>;
  readonly file: string;
  readonly name: string;
}

/** Parsed modules keyed by repo-relative POSIX path. */
type ModuleGraph = ReadonlyMap<string, IModuleSource>;

/** Separator between a file path and an exported name. */
const SEP = '#';

/**
 * Convert an absolute path to a repo-relative POSIX path.
 * @param root - Repository root.
 * @param file - Absolute file path.
 * @returns Relative POSIX path.
 */
function toRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

/**
 * Create an empty parser accumulator.
 * @returns The mutable draft.
 */
function emptyDraft(): IModuleDraft {
  return { local: [], named: [], stars: [], namespaces: [], imports: [] };
}

/**
 * Whether a statement carries an export or default modifier.
 * @param statement - Source statement.
 * @param kind - Modifier kind.
 * @returns True when present.
 */
function hasModifier(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  return modifiers?.some(mod => mod.kind === kind) ?? false;
}

/**
 * Extract the name of a declaration-bearing statement.
 * @param statement - Source statement.
 * @returns The declaration name, or false.
 */
function declarationName(statement: ts.Statement): string | false {
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  ) {
    return statement.name === undefined ? false : statement.name.getText();
  }
  return false;
}

/**
 * Collect the names declared by one exported statement.
 * @param statement - Source statement.
 * @returns Exported local names.
 */
function declaredNames(statement: ts.Statement): readonly string[] {
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return [];
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return ['default'];
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map(decl => decl.name.getText());
  }
  const name = declarationName(statement);
  return name === false ? [] : [name];
}

/**
 * Extract the imported names from an import clause.
 * @param clause - Import clause, when present.
 * @returns `*` for a namespace import, else the named/default imports.
 */
function importNames(clause?: ts.ImportClause): readonly string[] | '*' {
  if (clause === undefined) return [];
  const bindings = clause.namedBindings;
  if (bindings !== undefined && ts.isNamespaceImport(bindings)) return '*';
  const names: string[] = [];
  if (clause.name !== undefined) names.push('default');
  if (bindings !== undefined && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      names.push(element.propertyName?.text ?? element.name.text);
    }
  }
  return names;
}

/**
 * Resolve a specifier and push it onto the draft's import edges.
 * @param context - Parser context.
 * @param spec - Raw specifier.
 * @param names - Imported names, or `*`.
 * @returns True once processed.
 */
function addEdge(context: IParserContext, spec: string, names: readonly string[] | '*'): boolean {
  const resolved = resolveImport(context.file, spec);
  if (resolved !== UNRESOLVED) {
    context.draft.imports.push({ target: toRelative(context.root, resolved), names });
  }
  return true;
}

/**
 * Parse a local `export { A as B }` clause.
 * @param clause - Named export clause.
 * @returns Exported local names.
 */
function localExportNames(clause: ts.NamedExports): readonly string[] {
  return clause.elements.map(element => element.name.text);
}

/**
 * Parse a named re-export clause into exported aliases and target names.
 * @param clause - Named export clause.
 * @param target - Repo-relative target file.
 * @returns Named re-export records.
 */
function namedReexports(clause: ts.NamedExports, target: string): readonly INamedReexport[] {
  return clause.elements.map(element => ({
    exported: element.name.text,
    target,
    targetName: element.propertyName?.text ?? element.name.text,
  }));
}

/**
 * Resolve an export declaration's module target.
 * @param context - Parser context.
 * @param spec - Raw specifier.
 * @returns Repo-relative target, or false.
 */
function targetOf(context: IParserContext, spec: string): string | false {
  const resolved = resolveImport(context.file, spec);
  if (resolved === UNRESOLVED) return false;
  return toRelative(context.root, resolved);
}

/**
 * Record a local export clause (`export { A }` with no module).
 * @param statement - Export declaration.
 * @param draft - Parser accumulator.
 * @returns True once recorded.
 */
function addLocalExport(statement: ts.ExportDeclaration, draft: IModuleDraft): boolean {
  if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
    draft.local.push(...localExportNames(statement.exportClause));
  }
  return true;
}

/**
 * Record one remote export clause against its resolved target.
 * @param statement - Export declaration.
 * @param draft - Parser accumulator.
 * @param target - Repo-relative target file.
 * @returns True once recorded.
 */
function addRemoteExport(
  statement: ts.ExportDeclaration,
  draft: IModuleDraft,
  target: string,
): boolean {
  const clause = statement.exportClause;
  if (clause === undefined) {
    draft.stars.push(target);
    return true;
  }
  if (ts.isNamespaceExport(clause)) {
    draft.namespaces.push({ exported: clause.name.text, target });
    return true;
  }
  if (ts.isNamedExports(clause)) draft.named.push(...namedReexports(clause, target));
  return true;
}

/**
 * Parse one export declaration into the draft.
 * @param statement - Export declaration.
 * @param context - Parser context.
 * @returns True once processed.
 */
function parseExport(statement: ts.ExportDeclaration, context: IParserContext): boolean {
  const specifier = statement.moduleSpecifier;
  if (specifier === undefined || !ts.isStringLiteral(specifier)) {
    return addLocalExport(statement, context.draft);
  }
  const target = targetOf(context, specifier.text);
  if (target === false) return true;
  return addRemoteExport(statement, context.draft, target);
}

/**
 * Parse one import declaration into an import edge.
 * @param statement - Import declaration.
 * @param context - Parser context.
 * @returns True once processed.
 */
function parseImport(statement: ts.ImportDeclaration, context: IParserContext): boolean {
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return true;
  const names = importNames(statement.importClause);
  return addEdge(context, statement.moduleSpecifier.text, names);
}

/**
 * Collect dynamic `import('...')` edges from a subtree.
 * @param node - Current AST node.
 * @param context - Parser context.
 * @returns True once the subtree is walked.
 */
function dynamicImports(node: ts.Node, context: IParserContext): boolean {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [argument] = node.arguments;
    if (ts.isStringLiteral(argument)) addEdge(context, argument.text, '*');
  }
  ts.forEachChild(node, child => {
    dynamicImports(child, context);
    return false;
  });
  return true;
}

/**
 * Parse one module source into its exported surface and edges.
 * @param root - Repository root.
 * @param file - Absolute source path.
 * @param text - Source text.
 * @returns Parsed module source.
 */
function parseModuleSource(root: string, file: string, text: string): IModuleSource {
  const draft = emptyDraft();
  const context: IParserContext = { root, file, draft };
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) parseImport(statement, context);
    else if (ts.isExportDeclaration(statement)) parseExport(statement, context);
    else if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) {
      draft.local.push('default');
    } else draft.local.push(...declaredNames(statement));
  }
  dynamicImports(source, context);
  return { file: toRelative(root, file), ...draft };
}

/**
 * Parse every production source file into a module graph.
 * @param root - Repository root.
 * @returns Parsed modules.
 */
function loadModules(root: string): ModuleGraph {
  const files: string[] = [];
  const srcRoot = path.join(root, 'src');
  walkProdFiles(srcRoot, files);
  const graph = new Map<string, IModuleSource>();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const source = parseModuleSource(root, file, text);
    graph.set(source.file, source);
  }
  return graph;
}

/**
 * Collect every target a module can reach.
 * @param source - Parsed module.
 * @returns Import and re-export targets.
 */
function targetsOf(source: IModuleSource): readonly string[] {
  const named = source.named.map(item => item.target);
  const namespaces = source.namespaces.map(item => item.target);
  const imports = source.imports.map(edge => edge.target);
  return [...imports, ...named, ...source.stars, ...namespaces];
}

/**
 * Collect every exported name a module exposes, including `export *`.
 * @param graph - Parsed modules.
 * @param file - Module file.
 * @param seen - Cycle guard.
 * @returns Exported names.
 */
function exportsOf(graph: ModuleGraph, file: string, seen: ReadonlySet<string>): readonly string[] {
  const source = graph.get(file);
  if (source === undefined) return [];
  const names = new Set<string>([
    ...source.local,
    ...source.named.map(item => item.exported),
    ...source.namespaces.map(item => item.exported),
  ]);
  if (seen.has(file)) return [...names];
  const nextSeen = new Set(seen).add(file);
  for (const target of source.stars) {
    for (const name of exportsOf(graph, target, nextSeen)) {
      if (name !== 'default') names.add(name);
    }
  }
  return [...names];
}

/**
 * Resolve a direct local or namespace export, without following `export *`.
 * @param args - Resolver arguments.
 * @param source - Parsed source.
 * @returns The definition, namespace marker, or false.
 */
function directExport(args: IResolveArgs, source: IModuleSource): IExportRef | false {
  if (source.local.includes(args.name)) return { file: args.file, name: args.name };
  const namespace = source.namespaces.find(item => item.exported === args.name);
  return namespace === undefined ? false : { file: namespace.target, name: '*' };
}

/**
 * Resolve an export through named and `export *` re-exports.
 * @param args - Resolver arguments.
 * @param source - Parsed source.
 * @param nextSeen - Cycle guard including the current key.
 * @returns The definition, namespace marker, or false.
 */
function reexport(
  args: IResolveArgs,
  source: IModuleSource,
  nextSeen: ReadonlySet<string>,
): IExportRef | false {
  const named = source.named.find(item => item.exported === args.name);
  if (named !== undefined) {
    return resolveExport({ ...args, file: named.target, name: named.targetName, seen: nextSeen });
  }
  if (args.name === 'default') return false;
  for (const target of source.stars) {
    const resolved = resolveExport({ ...args, file: target, seen: nextSeen });
    if (resolved !== false) return resolved;
  }
  return false;
}

/**
 * Resolve an exported name through named and `export *` re-exports.
 * @param args - Resolver arguments.
 * @returns The local definition, a namespace marker, or false.
 */
function resolveExport(args: IResolveArgs): IExportRef | false {
  const key = `${args.file}${SEP}${args.name}`;
  if (args.seen.has(key)) return false;
  const source = args.graph.get(args.file);
  if (source === undefined) return false;
  const direct = directExport(args, source);
  if (direct !== false) return direct;
  const nextSeen = new Set(args.seen).add(key);
  return reexport(args, source, nextSeen);
}

/**
 * Mark every export of a module as used.
 * @param graph - Parsed modules.
 * @param used - Used-key accumulator.
 * @param file - Module file.
 * @returns True once every export is marked.
 */
function markAllExports(graph: ModuleGraph, used: Set<string>, file: string): boolean {
  for (const name of exportsOf(graph, file, new Set())) markExport({ graph, used, file, name });
  return true;
}

/**
 * Mark one export and its resolved definition as used.
 * @param args - Marker arguments.
 * @returns True once the export is recorded.
 */
function markExport(args: IMarkArgs): boolean {
  const resolved = resolveExport({
    graph: args.graph,
    file: args.file,
    name: args.name,
    seen: new Set(),
  });
  if (resolved === false) return true;
  if (resolved.name === '*') return markAllExports(args.graph, args.used, resolved.file);
  args.used.add(`${resolved.file}${SEP}${resolved.name}`);
  return true;
}

/**
 * Walk reachable files from the declared entry points.
 * @param graph - Parsed modules.
 * @param entries - Entry-point files.
 * @returns Reachable file set.
 */
function reachableFiles(graph: ModuleGraph, entries: readonly string[]): ReadonlySet<string> {
  const reachable = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop() ?? '';
    if (file === '' || reachable.has(file)) continue;
    const source = graph.get(file);
    if (source === undefined) continue;
    reachable.add(file);
    for (const target of targetsOf(source)) pending.push(target);
  }
  return reachable;
}

/**
 * Mark the exports consumed by imports and the public entry points.
 * @param graph - Parsed modules.
 * @param reachable - Reachable file set.
 * @param entries - Entry-point files.
 * @returns Used `file#name` keys.
 */
function usedExports(
  graph: ModuleGraph,
  reachable: ReadonlySet<string>,
  entries: readonly string[],
): ReadonlySet<string> {
  const used = new Set<string>();
  for (const entry of entries) markAllExports(graph, used, entry);
  for (const file of reachable) {
    const source = graph.get(file);
    if (source === undefined) continue;
    for (const edge of source.imports) {
      if (edge.names === '*') markAllExports(graph, used, edge.target);
      else for (const name of edge.names) markExport({ graph, used, file: edge.target, name });
    }
  }
  return used;
}

/**
 * Collect unreachable files and unused local exports.
 * @param graph - Parsed modules.
 * @param entries - Entry-point files.
 * @returns Sorted dead items.
 */
function analyze(graph: ModuleGraph, entries: readonly string[]): IDeadCodeReport {
  const reachable = reachableFiles(graph, entries);
  const used = usedExports(graph, reachable, entries);
  const files = [...graph.keys()].filter(file => !reachable.has(file)).sort();
  const exports: string[] = [];
  for (const file of graph.keys()) {
    const source = graph.get(file);
    if (source === undefined) continue;
    for (const name of source.local) {
      if (!used.has(`${file}${SEP}${name}`)) exports.push(`${file}${SEP}${name}`);
    }
  }
  return { files, exports: exports.sort() };
}

/**
 * Compare current dead items with the frozen baseline.
 * @param current - Current report.
 * @param baseline - Frozen baseline.
 * @returns Items that appeared since the baseline.
 */
function findRegressions(current: IDeadCodeReport, baseline: IDeadCodeBaseline): IDeadCodeReport {
  const knownFiles = new Set(baseline.unreachableFiles);
  const knownExports = new Set(baseline.unusedExports);
  return {
    files: current.files.filter(file => !knownFiles.has(file)),
    exports: current.exports.filter(item => !knownExports.has(item)),
  };
}

/**
 * Run the reachability gate over the repository.
 * @param root - Repository root.
 * @param entries - Entry-point files.
 * @returns Dead files and unused local exports.
 */
function scanDeadCode(root: string, entries: readonly string[]): IDeadCodeReport {
  const graph = loadModules(root);
  return analyze(graph, entries);
}

export type {
  IDeadCodeBaseline,
  IDeadCodeReport,
  IExportRef,
  IImportEdge,
  IModuleSource,
  INamedReexport,
  INamespaceReexport,
  ModuleGraph,
};
export {
  analyze,
  exportsOf,
  findRegressions,
  loadModules,
  parseModuleSource,
  resolveExport,
  scanDeadCode,
  targetsOf,
};
