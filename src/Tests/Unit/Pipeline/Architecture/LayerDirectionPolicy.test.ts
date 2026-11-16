/**
 * Layer-direction policy — a shrink-only ratchet over the Pipeline's eight
 * production layers.
 *
 * <p>The matrix describes the intended dependency direction: bank code may
 * compose the core, and every layer may use the shared infrastructure below
 * it, while Types is a leaf. Current violations are frozen in
 * `Tools/layer-direction.baseline.json`; a new violation fails, and a fixed
 * one must be removed from the baseline so the ratchet only shrinks.
 *
 * <p>Two extra rules protect the neutral layers: no bank-named module and no
 * `CompanyTypes.<X>` reference may appear in Phases, Mediator or Strategy.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';

import { CompanyTypes } from '../../../../Definitions.js';
import { resolveImport, walkProdFiles } from '../../../Tools/ImportGraphScan.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const PIPELINE_ROOT = path.join(HERE, '..', '..', '..', '..', 'Scrapers', 'Pipeline');
const BASELINE_PATH = path.join(HERE, '..', '..', '..', 'Tools', 'layer-direction.baseline.json');

/** The eight production layers, highest composition layer first. */
const LAYERS = [
  'Banks',
  'Core',
  'Phases',
  'Mediator',
  'Strategy',
  'Registry',
  'Logging',
  'Types',
] as const;

type Layer = (typeof LAYERS)[number];

/** Bank families whose shapes must eventually leave the neutral Phases layer. */
const FAMILY_TOKENS = ['Ring', 'FibiGroup', 'TelebankGroup', 'CardIssuer'] as const;

/** Layers that must not name a bank module or a `CompanyTypes` member. */
const NEUTRAL_LAYERS: readonly Layer[] = ['Phases', 'Mediator', 'Strategy'];

/** Allowed import targets per source layer. */
const ALLOWED: Readonly<Record<Layer, readonly Layer[]>> = {
  Banks: [...LAYERS],
  Core: ['Core', 'Phases', 'Mediator', 'Strategy', 'Registry', 'Logging', 'Types'],
  Phases: ['Phases', 'Mediator', 'Strategy', 'Registry', 'Logging', 'Types'],
  Mediator: ['Mediator', 'Strategy', 'Registry', 'Logging', 'Types'],
  Strategy: ['Strategy', 'Registry', 'Logging', 'Types'],
  Registry: ['Registry', 'Strategy', 'Logging', 'Types'],
  Logging: ['Logging', 'Types'],
  Types: ['Types'],
};

/** Frozen violations, removed as the owning phases shrink them. */
interface ILayerBaseline {
  readonly note: string;
  readonly layerViolations: readonly string[];
  readonly bankNamedFiles: readonly string[];
  readonly companyTypesReferences: readonly string[];
}

/**
 * Whether one layer may import another.
 * @param from - Importing layer.
 * @param to - Imported layer.
 * @returns True when the edge is permitted.
 */
function isAllowed(from: Layer, to: Layer): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Classify one absolute production file by its top-level directory.
 * @param file - Absolute file path.
 * @returns The layer, or false when the file is outside the eight layers.
 */
function layerOf(file: string): Layer | false {
  const relative = path.relative(PIPELINE_ROOT, file);
  const top = relative.split(path.sep)[0];
  return LAYERS.find((layer): boolean => layer === top) ?? false;
}

/**
 * Normalize a Pipeline-relative path to forward slashes.
 * @param file - Absolute file path.
 * @returns Pipeline-relative POSIX path.
 */
function posixRelative(file: string): string {
  return path.relative(PIPELINE_ROOT, file).split(path.sep).join('/');
}

/**
 * List every production file under the Pipeline root.
 * @returns Absolute production file paths.
 */
function listFiles(): readonly string[] {
  const files: string[] = [];
  walkProdFiles(PIPELINE_ROOT, files);
  return files;
}

/**
 * Read every static, re-exported and dynamic import specifier from one file.
 * @param file - Absolute production file path.
 * @returns Specifiers in source order.
 */
function importSpecifiers(file: string): readonly string[] {
  const text = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  collectSpecifiers(sourceFile, specs);
  return specs;
}

/**
 * Collect module specifiers from one syntax subtree.
 * @param node - Current node.
 * @param specs - Accumulator, mutated in place.
 * @returns True once the subtree is visited.
 */
function collectSpecifiers(node: ts.Node, specs: string[]): true {
  const specifier = specifierOf(node);
  if (specifier !== '') specs.push(specifier);
  ts.forEachChild(node, (child): false => {
    collectSpecifiers(child, specs);
    return false;
  });
  return true;
}

/**
 * Read the module specifier a node carries, when it is an import form.
 * @param node - Candidate syntax node.
 * @returns Specifier text, or '' for other nodes.
 */
function specifierOf(node: ts.Node): string {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier;
    return specifier === undefined ? '' : stringTextOf(specifier);
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return stringTextOf(node.moduleReference.expression);
  }
  if (ts.isImportTypeNode(node)) {
    const argument = node.argument;
    return ts.isLiteralTypeNode(argument) ? literalTextOf(argument.literal) : '';
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return importArgumentText(node);
  }
  return '';
}

/**
 * Read a string-literal node's text.
 * @param node - Candidate node.
 * @returns The literal text, or '' for a missing/non-literal node.
 */
function stringTextOf(node: ts.Node): string {
  return ts.isStringLiteral(node) ? node.text : '';
}

/**
 * Read a statically resolvable string-like literal.
 * @param node - String literal or no-substitution template literal.
 * @returns The literal text, or '' for any other node.
 */
function literalTextOf(node: ts.Node): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return '';
}

/**
 * Read the literal argument of a dynamic import call.
 * @param node - Call expression.
 * @returns The first argument's text, or '' when it is not a string literal.
 */
function importArgumentText(node: ts.CallExpression): string {
  const argument = node.arguments[0];
  return literalTextOf(argument);
}

/**
 * Collect forbidden cross-layer edges as `relative/from.ts -> TargetLayer`.
 * @param files - Production files to scan.
 * @returns Unique frozen-eligible violations, sorted.
 */
function collectLayerViolations(files: readonly string[]): readonly string[] {
  const violations = new Set<string>();
  for (const file of files) collectFileViolations(file, violations);
  return [...violations].sort();
}

/**
 * Add one file's forbidden imports to the violation set.
 * @param file - Importer.
 * @param violations - Accumulator, mutated in place.
 * @returns The same accumulator.
 */
function collectFileViolations(file: string, violations: Set<string>): ReadonlySet<string> {
  const from = layerOf(file);
  if (from === false) return violations;
  for (const spec of importSpecifiers(file)) {
    const target = resolveImport(file, spec);
    const to = layerOf(target);
    if (to === false || to === from || isAllowed(from, to)) continue;
    const importer = posixRelative(file);
    const targetModule = posixRelative(target);
    violations.add(`${importer} -> ${targetModule}`);
  }
  return violations;
}

/**
 * Whether a bank token appears at an identifier boundary inside a segment.
 *
 * <p>Matches `PagiShape`, `ShapeLeumi`, `ClientCertOneZero`, `OneZero.clientCert`
 * and `OneZero-clientCert`, while `Pagination` does not match `Pagi`.
 * @param segment - One file or directory name.
 * @param token - Bank or family token.
 * @returns True when the token is a whole identifier part.
 */
function hasTokenAtBoundary(segment: string, token: string): boolean {
  const lowerSegment = segment.toLowerCase();
  const lowerToken = token.toLowerCase();
  let from = 0;
  while (from <= lowerSegment.length - lowerToken.length) {
    const at = lowerSegment.indexOf(lowerToken, from);
    if (at < 0) return false;
    if (isWordBoundary(segment, token, at)) return true;
    from = at + 1;
  }
  return false;
}

/**
 * Check the characters around one token occurrence.
 * @param segment - Whole segment.
 * @param token - Matched token.
 * @param at - Start index of the match.
 * @returns True when both sides are identifier boundaries.
 */
function isWordBoundary(segment: string, token: string, at: number): boolean {
  const before = at === 0 ? '' : segment[at - 1];
  const first = segment[at] ?? '';
  const after = segment[at + token.length] ?? '';
  const isStartBoundary =
    before === '' ||
    /[^A-Za-z0-9]/u.test(before) ||
    (/[a-z0-9]/u.test(before) && /[A-Z]/u.test(first));
  const isEndBoundary = after === '' || /[^A-Za-z0-9]/u.test(after) || /[A-Z0-9]/u.test(after);
  return isStartBoundary && isEndBoundary;
}

/**
 * Whether any segment of a relative path names a bank or family module.
 * @param relativePath - Pipeline-relative path.
 * @param tokens - Bank and family tokens.
 * @returns True when a segment starts with one token at a boundary.
 */
function isBankNamed(relativePath: string, tokens: readonly string[]): boolean {
  const segments = relativePath.replace(/\.ts$/u, '').split('/');
  return segments.some((segment): boolean =>
    tokens.some((token): boolean => hasTokenAtBoundary(segment, token)),
  );
}

/**
 * List bank-named modules in the neutral layers.
 * @param files - Production files to scan.
 * @param tokens - Bank and family tokens.
 * @returns Pipeline-relative paths, sorted.
 */
function collectBankNamedFiles(
  files: readonly string[],
  tokens: readonly string[],
): readonly string[] {
  const hits: string[] = [];
  for (const file of files) {
    const layer = layerOf(file);
    if (layer === false || !NEUTRAL_LAYERS.includes(layer)) continue;
    const relative = posixRelative(file);
    if (isBankNamed(relative, tokens)) hits.push(relative);
  }
  return hits.sort();
}

/** Imported bindings through which a file can reach the `CompanyTypes` enum. */
interface IEnumBindings {
  readonly direct: Set<string>;
  readonly namespaces: Set<string>;
}

/** The enum's member names, used to recognise a property or element access. */
const BANK_MEMBERS: ReadonlySet<string> = new Set(Object.keys(CompanyTypes));

/**
 * Read the local aliases that can reach the `CompanyTypes` enum.
 * @param sourceFile - Parsed source file.
 * @returns Direct and namespace import bindings.
 */
function enumBindings(sourceFile: ts.SourceFile): IEnumBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (ts.isNamedImports(bindings)) collectDirectBindings(bindings, direct);
  }
  return { direct, namespaces };
}

/**
 * Add named imports that resolve to `CompanyTypes`, including aliases.
 * @param bindings - Named import clause.
 * @param direct - Accumulator of local binding names.
 * @returns The same accumulator.
 */
function collectDirectBindings(
  bindings: ts.NamedImports,
  direct: Set<string>,
): ReadonlySet<string> {
  for (const element of bindings.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    if (imported === 'CompanyTypes') direct.add(element.name.text);
  }
  return direct;
}

/**
 * Whether an expression is the imported enum binding or a namespace path to it.
 * @param expression - Property or element access target.
 * @param bindings - Local import bindings.
 * @returns True when the expression names `CompanyTypes`.
 */
function isEnumBase(expression: ts.Expression, bindings: IEnumBindings): boolean {
  if (ts.isIdentifier(expression)) return bindings.direct.has(expression.text);
  const isNamespaceEnum =
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'CompanyTypes' &&
    ts.isIdentifier(expression.expression);
  return isNamespaceEnum && bindings.namespaces.has(expression.expression.text);
}

/**
 * Add every member named by an object-destructuring binding.
 * @param pattern - Object binding pattern.
 * @param members - Accumulator of referenced member names.
 * @returns The same accumulator.
 */
function collectBindingMembers(
  pattern: ts.ObjectBindingPattern,
  members: Set<string>,
): ReadonlySet<string> {
  for (const element of pattern.elements) {
    const named = element.propertyName ?? element.name;
    const isNamed = ts.isIdentifier(named) || ts.isStringLiteral(named);
    if (isNamed && BANK_MEMBERS.has(named.text)) members.add(named.text);
  }
  return members;
}

/**
 * Whether a qualified type name starts at the enum binding.
 * @param left - Left side of the qualified name.
 * @param bindings - Local import bindings.
 * @returns True for `CompanyTypes` or a namespace path to it.
 */
function isEnumQualifiedLeft(left: ts.EntityName, bindings: IEnumBindings): boolean {
  if (ts.isIdentifier(left)) return bindings.direct.has(left.text);
  const isNamespaceEnum =
    ts.isQualifiedName(left) && left.right.text === 'CompanyTypes' && ts.isIdentifier(left.left);
  return isNamespaceEnum && bindings.namespaces.has(left.left.text);
}

/**
 * Collect a property or element access rooted at the enum binding.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator of referenced member names.
 * @returns The same accumulator.
 */
function collectAccessMember(
  node: ts.Node,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  if (ts.isPropertyAccessExpression(node)) {
    const member = node.name.text;
    if (BANK_MEMBERS.has(member) && isEnumBase(node.expression, bindings)) members.add(member);
  }
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;
    const member = literalTextOf(argument);
    if (BANK_MEMBERS.has(member) && isEnumBase(node.expression, bindings)) members.add(member);
  }
  return members;
}

/**
 * Collect an object-destructuring binding of the enum.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator of referenced member names.
 * @returns The same accumulator.
 */
function collectDestructuredMember(
  node: ts.Node,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  const isEnumDestructure =
    ts.isVariableDeclaration(node) &&
    ts.isObjectBindingPattern(node.name) &&
    node.initializer !== undefined &&
    isEnumBase(node.initializer, bindings);
  if (isEnumDestructure) collectBindingMembers(node.name, members);
  return members;
}

/**
 * Collect a qualified type name rooted at the enum binding.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator of referenced member names.
 * @returns The same accumulator.
 */
function collectQualifiedMember(
  node: ts.Node,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  const isEnumType =
    ts.isQualifiedName(node) &&
    BANK_MEMBERS.has(node.right.text) &&
    isEnumQualifiedLeft(node.left, bindings);
  if (isEnumType) members.add(node.right.text);
  return members;
}

/**
 * Flag an alias that can carry the enum into a neutral layer.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator, prefixed with `alias:` for an alias binding.
 * @returns The same accumulator.
 */
function collectAliasMember(
  node: ts.Node,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  if (!ts.isVariableDeclaration(node)) return members;
  if (ts.isIdentifier(node.name) && node.initializer !== undefined) {
    if (isEnumBase(node.initializer, bindings)) members.add(`alias:${node.name.text}`);
  }
  collectNamespaceAlias(node, bindings, members);
  return members;
}

/**
 * Flag a namespace destructuring such as `const { CompanyTypes: banks } = defs`.
 * @param node - Variable declaration.
 * @param bindings - Local import bindings.
 * @param members - Accumulator.
 * @returns The same accumulator.
 */
function collectNamespaceAlias(
  node: ts.VariableDeclaration,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  if (!ts.isObjectBindingPattern(node.name) || node.initializer === undefined) return members;
  if (!ts.isIdentifier(node.initializer) || !bindings.namespaces.has(node.initializer.text)) {
    return members;
  }
  for (const element of node.name.elements) {
    const property = element.propertyName;
    const isCompanyProperty =
      property !== undefined && ts.isIdentifier(property) && property.text === 'CompanyTypes';
    if (isCompanyProperty && ts.isIdentifier(element.name)) {
      members.add(`alias:${element.name.text}`);
    }
  }
  return members;
}

/**
 * Collect an indexed enum type such as `typeof CompanyTypes['Leumi']`.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator.
 * @returns The same accumulator.
 */
function collectIndexedMember(
  node: ts.Node,
  bindings: IEnumBindings,
  members: Set<string>,
): ReadonlySet<string> {
  if (!ts.isIndexedAccessTypeNode(node)) return members;
  const member = ts.isLiteralTypeNode(node.indexType) ? literalTextOf(node.indexType.literal) : '';
  if (BANK_MEMBERS.has(member) && isEnumTypeObject(node.objectType, bindings)) members.add(member);
  return members;
}

/**
 * Whether an indexed-access object names the enum type.
 * @param node - Indexed object type.
 * @param bindings - Local import bindings.
 * @returns True for `typeof CompanyTypes` or `CompanyTypes`.
 */
function isEnumTypeObject(node: ts.TypeNode, bindings: IEnumBindings): boolean {
  if (ts.isTypeQueryNode(node))
    return ts.isIdentifier(node.exprName) && bindings.direct.has(node.exprName.text);
  return (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    bindings.direct.has(node.typeName.text)
  );
}

/**
 * Collect bank-member accesses from one syntax subtree.
 * @param node - Current node.
 * @param bindings - Local import bindings.
 * @param members - Accumulator of referenced member names.
 * @returns True once the subtree is visited.
 */
function collectEnumMembers(node: ts.Node, bindings: IEnumBindings, members: Set<string>): true {
  collectAccessMember(node, bindings, members);
  collectDestructuredMember(node, bindings, members);
  collectQualifiedMember(node, bindings, members);
  collectAliasMember(node, bindings, members);
  collectIndexedMember(node, bindings, members);
  ts.forEachChild(node, (child): false => {
    collectEnumMembers(child, bindings, members);
    return false;
  });
  return true;
}

/**
 * List neutral-layer references to a concrete `CompanyTypes` member.
 * @param files - Production files to scan.
 * @returns `relative/path.ts -> Member` entries, sorted.
 */
function collectCompanyTypeReferences(files: readonly string[]): readonly string[] {
  const hits: string[] = [];
  for (const file of files) {
    const layer = layerOf(file);
    if (layer === false || !NEUTRAL_LAYERS.includes(layer)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const bindings = enumBindings(sourceFile);
    const hasMembers = new Set<string>();
    collectEnumMembers(sourceFile, bindings, hasMembers);
    const relative = posixRelative(file);
    for (const member of hasMembers) hits.push(`${relative} -> ${member}`);
  }
  return hits.sort();
}

/**
 * Read the committed shrink-only baseline.
 * @returns Parsed baseline.
 */
function readBaseline(): ILayerBaseline {
  const text = fs.readFileSync(BASELINE_PATH, 'utf8');
  return JSON.parse(text) as ILayerBaseline;
}

/** One comparison against the frozen baseline. */
interface IDrift {
  readonly additions: readonly string[];
  readonly removals: readonly string[];
}

/**
 * Compare one current list against the frozen baseline.
 * @param current - Current entries.
 * @param frozen - Baseline entries.
 * @returns New entries and fixed entries, both empty on a clean ratchet.
 */
function driftOf(current: readonly string[], frozen: readonly string[]): IDrift {
  const currentSet = new Set(current);
  const frozenSet = new Set(frozen);
  const additions = current.filter((entry): boolean => !frozenSet.has(entry));
  const removals = frozen.filter((entry): boolean => !currentSet.has(entry));
  return { additions, removals };
}

const FILES = listFiles();
const BASELINE = readBaseline();
const BANK_TOKENS = [...Object.keys(CompanyTypes), ...FAMILY_TOKENS];

describe('Pipeline layer-direction policy', () => {
  it('actually scans the production tree (guards against a vacuous pass)', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it('classifies every production file into one of the eight layers', () => {
    const unknown = FILES.map(posixRelative).filter((relative): boolean => {
      const top = relative.split('/')[0];
      return !LAYERS.some((layer): boolean => layer === top);
    });
    expect(unknown).toStrictEqual([]);
  });

  it('adds no forbidden layer edge and leaves no fixed entry behind', () => {
    const violations = collectLayerViolations(FILES);
    const drift = driftOf(violations, BASELINE.layerViolations);
    expect(drift).toStrictEqual({ additions: [], removals: [] });
  });

  it('adds no bank-named module in Phases, Mediator or Strategy', () => {
    const bankFiles = collectBankNamedFiles(FILES, BANK_TOKENS);
    const drift = driftOf(bankFiles, BASELINE.bankNamedFiles);
    expect(drift).toStrictEqual({ additions: [], removals: [] });
  });

  it('adds no CompanyTypes reference in Phases, Mediator or Strategy', () => {
    const companyReferences = collectCompanyTypeReferences(FILES);
    const drift = driftOf(companyReferences, BASELINE.companyTypesReferences);
    expect(drift).toStrictEqual({ additions: [], removals: [] });
  });

  it('rejects upward edges and permits bank composition (negative control)', () => {
    const isTypesToMediatorAllowed = isAllowed('Types', 'Mediator');
    const isCoreToBanksAllowed = isAllowed('Core', 'Banks');
    const isBanksToCoreAllowed = isAllowed('Banks', 'Core');
    const isPhasesToRegistryAllowed = isAllowed('Phases', 'Registry');
    expect(isTypesToMediatorAllowed).toBe(false);
    expect(isCoreToBanksAllowed).toBe(false);
    expect(isBanksToCoreAllowed).toBe(true);
    expect(isPhasesToRegistryAllowed).toBe(true);
  });

  it('ignores a CompanyTypes mention in a comment (negative control)', () => {
    const source = '// Supports CompanyTypes.Hapoalim\nconst value = 1;';
    const sourceFile = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
    const bindings = enumBindings(sourceFile);
    const hasMembers = new Set<string>();
    collectEnumMembers(sourceFile, bindings, hasMembers);
    const members = [...hasMembers];
    expect(members).toStrictEqual([]);
  });

  it('detects aliased and string-index enum accesses (negative control)', () => {
    const source = [
      "import { CompanyTypes as CT } from 'probe';",
      'const a = CT.Leumi;',
      "const b = CT['Pagi'];",
      "const { 'Max': max } = CT;",
      'type T = CT.Discount;',
      'const banks = CT;',
      'const c = banks.Yahav;',
      "type I = typeof CT['Yahav'];",
      'const e = CT[`Pepper`];',
    ].join('\n');
    const sourceFile = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
    const bindings = enumBindings(sourceFile);
    const hasMembers = new Set<string>();
    collectEnumMembers(sourceFile, bindings, hasMembers);
    const members = [...hasMembers].sort();
    expect(members).toStrictEqual([
      'Discount',
      'Leumi',
      'Max',
      'Pagi',
      'Pepper',
      'Yahav',
      'alias:banks',
    ]);
  });

  it('does not flag a shadowing parameter or miss namespace destructuring (negative control)', () => {
    const shadowSource = 'function f(banks: { Leumi: string }) { return banks.Leumi; }';
    const shadowFile = ts.createSourceFile('probe.ts', shadowSource, ts.ScriptTarget.Latest, true);
    const shadowMembers = new Set<string>();
    const shadowBindings = enumBindings(shadowFile);
    collectEnumMembers(shadowFile, shadowBindings, shadowMembers);
    const shadowFound = [...shadowMembers];
    expect(shadowFound).toStrictEqual([]);

    const aliasSource = [
      "import * as defs from 'probe';",
      'const { CompanyTypes: banks } = defs;',
      'const value = banks.Leumi;',
    ].join('\n');
    const aliasFile = ts.createSourceFile('probe.ts', aliasSource, ts.ScriptTarget.Latest, true);
    const aliasMembers = new Set<string>();
    const aliasBindings = enumBindings(aliasFile);
    collectEnumMembers(aliasFile, aliasBindings, aliasMembers);
    const aliasFound = [...aliasMembers].sort();
    expect(aliasFound).toStrictEqual(['alias:banks']);
  });

  it('collects import types and no-substitution template imports (negative control)', () => {
    const source = [
      "type T = import('../Mediator/Api/ApiMediator.js').IApiMediator;",
      'const p = import(`../Mediator/Network/FetchConfig.js`);',
      "// import('../Types/Commented.js');",
    ].join('\n');
    const sourceFile = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
    const specs: string[] = [];
    collectSpecifiers(sourceFile, specs);
    expect(specs).toStrictEqual([
      '../Mediator/Api/ApiMediator.js',
      '../Mediator/Network/FetchConfig.js',
    ]);
  });

  it('does not treat a longer word as a bank module (negative control)', () => {
    const isPaginationBankNamed = hasTokenAtBoundary('Pagination', 'Pagi');
    const isPagiShapeBankNamed = hasTokenAtBoundary('PagiShape', 'Pagi');
    const isSuffixBankNamed = hasTokenAtBoundary('ShapeLeumi', 'Leumi');
    const isDottedBankNamed = hasTokenAtBoundary('OneZero.clientCert', 'OneZero');
    const isHyphenBankNamed = hasTokenAtBoundary('OneZero-clientCert', 'OneZero');
    const isLowerCamelBankNamed = hasTokenAtBoundary('oneZeroClientCert', 'OneZero');
    expect(isPaginationBankNamed).toBe(false);
    expect(isPagiShapeBankNamed).toBe(true);
    expect(isSuffixBankNamed).toBe(true);
    expect(isDottedBankNamed).toBe(true);
    expect(isHyphenBankNamed).toBe(true);
    expect(isLowerCamelBankNamed).toBe(true);
  });
});
