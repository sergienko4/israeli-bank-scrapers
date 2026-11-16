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

import { CompanyTypes } from '../../../../Definitions.js';
import { resolveImport, walkProdFiles } from '../../../Tools/ImportGraphScan.js';
import {
  collectCompanyTypeReferences,
  enumMembersOf,
  importSpecifiers,
  specifiersOf,
} from '../../../Tools/LayerEnumReferences.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const PIPELINE_ROOT = path.join(HERE, '..', '..', '..', '..', 'Scrapers', 'Pipeline');
const BASELINE_PATH = path.join(HERE, '..', '..', '..', 'Tools', 'layer-direction.baseline.json');
const POLICY_PATH = path.join(HERE, '..', '..', '..', 'Tools', 'layer-direction.policy.json');

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

/** Layers and allowed import targets, kept as reviewable data for the guard. */
interface ILayerPolicy {
  readonly note: string;
  readonly layers: readonly string[];
  readonly allowed: Readonly<Record<string, readonly string[]>>;
}

/** Frozen violations, removed as the owning phases shrink them. */
interface ILayerBaseline {
  readonly note: string;
  readonly layerViolations: readonly string[];
  readonly bankNamedFiles: readonly string[];
  readonly companyTypesReferences: readonly string[];
}

/**
 * Read the allowed-edge policy.
 * @returns Parsed policy.
 */
function readPolicy(): ILayerPolicy {
  const text = fs.readFileSync(POLICY_PATH, 'utf8');
  return JSON.parse(text) as ILayerPolicy;
}

/**
 * Whether one layer may import another.
 * @param from - Importing layer.
 * @param to - Imported layer.
 * @returns True when the edge is permitted.
 */
function isAllowed(from: Layer, to: Layer): boolean {
  const allowed = POLICY.allowed[from] ?? [];
  return allowed.includes(to);
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
  const importer = posixRelative(file);
  for (const spec of importSpecifiers(file)) {
    if (spec === '<dynamic>' || spec === '<require>') {
      violations.add(`${importer} -> dynamic-import`);
      continue;
    }
    const bareSpec = spec.split(/[?#]/u)[0];
    const target = resolveImport(file, bareSpec);
    const isExcluded = /(?:^|\/)(?:Tests|coverage)(?:\/|$)/u.test(target);
    if (isExcluded) {
      violations.add(`${importer} -> excluded:${posixRelative(target)}`);
      continue;
    }
    const to = layerOf(target);
    if (to === false || to === from || isAllowed(from, to)) continue;
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
 * Check the character before a token occurrence.
 * @param segment - Whole segment.
 * @param at - Start index of the match.
 * @returns True when the token starts an identifier part.
 */
function isStartBoundary(segment: string, at: number): boolean {
  const before = at === 0 ? '' : segment[at - 1];
  const first = segment[at] ?? '';
  const isLowerToPascal = /[a-z0-9]/u.test(before) && /[A-Z]/u.test(first);
  const isAcronymToPascal =
    /[A-Z]/u.test(before) && /[A-Z]/u.test(first) && /[a-z]/u.test(segment[at + 1] ?? '');
  return before === '' || /[^A-Za-z0-9]/u.test(before) || isLowerToPascal || isAcronymToPascal;
}

/**
 * Check the character after a token occurrence.
 * @param segment - Whole segment.
 * @param token - Matched token.
 * @param at - Start index of the match.
 * @returns True when the token ends an identifier part.
 */
function isEndBoundary(segment: string, token: string, at: number): boolean {
  const after = segment[at + token.length] ?? '';
  return after === '' || /[^A-Za-z0-9]/u.test(after) || /[A-Z0-9]/u.test(after);
}

/**
 * Check the characters around one token occurrence.
 * @param segment - Whole segment.
 * @param token - Matched token.
 * @param at - Start index of the match.
 * @returns True when both sides are identifier boundaries.
 */
function isWordBoundary(segment: string, token: string, at: number): boolean {
  return isStartBoundary(segment, at) && isEndBoundary(segment, token, at);
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
const POLICY = readPolicy();
const BASELINE = readBaseline();
const BANK_TOKENS = [...Object.keys(CompanyTypes), ...FAMILY_TOKENS];

describe('Pipeline layer-direction policy', () => {
  it('actually scans the production tree and pins the policy layers', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(POLICY.layers).toStrictEqual([...LAYERS]);
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
    const companyReferences = collectCompanyTypeReferences(FILES, NEUTRAL_LAYERS, PIPELINE_ROOT);
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
    const members = enumMembersOf(source);
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
      "const { ['Leumi']: dupe } = CT;",
      "type J = import('../../Definitions.js').CompanyTypes.Amex;",
      "type N = typeof import('../../Definitions.js').CompanyTypes['Mizrahi'];",
      "const key = 'Leumi';",
      'const dynamicKey = CT[key];',
    ].join('\n');
    const members = enumMembersOf(source);
    expect(members).toStrictEqual([
      'Amex',
      'Discount',
      'Leumi',
      'Max',
      'Mizrahi',
      'Pagi',
      'Pepper',
      'Yahav',
      'alias:banks',
      'dynamic:key',
    ]);
  });

  it('does not flag a shadowing parameter or miss namespace destructuring (negative control)', () => {
    const shadowSource = [
      "import { CompanyTypes } from 'probe';",
      "import * as defs from '../../Definitions.js';",
      'function f(CompanyTypes: { Leumi: string }) { return CompanyTypes.Leumi; }',
      'function g(banks: { Leumi: string }) { return banks.Leumi; }',
      'function h<CT>(x: CT) { type S = typeof CT["Hapoalim"]; }',
      "function j(defs: { 'CompanyTypes': { Leumi: string } }) {",
      "  return defs['CompanyTypes'].Leumi;",
      '}',
      'function loop(localBanks: Array<{ Leumi: string }>) {',
      '  for (const CT of localBanks) { return CT.Leumi; }',
      '}',
      "enum CT { Leumi = 'local' }",
      'type Local = CT.Leumi;',
    ].join('\n');
    const shadowFound = enumMembersOf(shadowSource);
    expect(shadowFound).toStrictEqual([]);

    const aliasSource = [
      "import * as defs from '../../Definitions.js';",
      "const { CompanyTypes: banks, 'CompanyTypes': banks2 } = defs;",
      'const { CompanyTypes: { Leumi: nested } } = defs;',
      'const value = banks.Leumi;',
      "const value2 = defs['CompanyTypes'].Leumi;",
      'const wrapped = (banks2 as typeof banks2);',
      'const value3 = wrapped.Pepper;',
      'const ns = defs;',
      'const viaNs = ns.CompanyTypes.Leumi;',
      "type K = typeof defs.CompanyTypes['Mercantile'];",
    ].join('\n');
    const aliasFound = enumMembersOf(aliasSource);
    expect(aliasFound).toStrictEqual([
      'Leumi',
      'Mercantile',
      'alias:banks',
      'alias:banks2',
      'alias:namespace:ns',
    ]);
  });

  it('records the enum after an unrelated destructuring (negative control)', () => {
    const source = [
      "import { CompanyTypes } from 'probe';",
      'function f(input: { CompanyTypes: string }) {',
      '  const { CompanyTypes: other } = input;',
      '  return [CompanyTypes.Leumi, other];',
      '}',
    ].join('\n');
    const members = enumMembersOf(source);
    expect(members).toStrictEqual(['Leumi']);
  });

  it('does not record a shadowed namespace destructuring (negative control)', () => {
    const source = [
      'function f(defs: { CompanyTypes: { Leumi: string } }) {',
      '  const { CompanyTypes: banks } = defs;',
      '  return banks.Leumi;',
      '}',
    ].join('\n');
    const members = enumMembersOf(source);
    expect(members).toStrictEqual([]);
  });

  it('keeps a value enum reachable when only a type parameter shadows it', () => {
    const source = [
      "import { CompanyTypes as CT } from 'probe';",
      'function f<CT>(x: CT) { return [x, CT.Leumi]; }',
    ].join('\n');
    const members = enumMembersOf(source);
    expect(members).toStrictEqual(['Leumi']);
  });

  it('does not record an alias shadowed by a parameter (negative control)', () => {
    const source = [
      "import { CompanyTypes as CT } from 'probe';",
      'function f(CT: { Leumi: string }) { return CT.Leumi; }',
    ].join('\n');
    const members = enumMembersOf(source);
    expect(members).toStrictEqual([]);
  });

  it('ignores an unrelated namespace alias (negative control)', () => {
    const source = [
      "import * as fs from 'node:fs';",
      'const io = fs;',
      'const value = io.readFileSync;',
    ].join('\n');
    const members = enumMembersOf(source);
    expect(members).toStrictEqual([]);
  });

  it('records shorthand namespace destructuring (negative control)', () => {
    const source = [
      "import * as defs from '../../Definitions.js';",
      'const { CompanyTypes } = defs;',
      'const value = CompanyTypes.Leumi;',
    ].join('\n');
    const members = enumMembersOf(source);
    expect(members).toStrictEqual(['alias:CompanyTypes']);
  });

  it('collects import types and no-substitution template imports (negative control)', () => {
    const source = [
      "type T = import('../Mediator/Api/ApiMediator.js').IApiMediator;",
      'const p = import(`../Mediator/Network/FetchConfig.js`);',
      "// import('../Types/Commented.js');",
    ].join('\n');
    const specs = specifiersOf(source);
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
    const isAcronymBankNamed = hasTokenAtBoundary('TLSOneZeroClientCert', 'OneZero');
    expect(isPaginationBankNamed).toBe(false);
    expect(isPagiShapeBankNamed).toBe(true);
    expect(isSuffixBankNamed).toBe(true);
    expect(isDottedBankNamed).toBe(true);
    expect(isHyphenBankNamed).toBe(true);
    expect(isLowerCamelBankNamed).toBe(true);
    expect(isAcronymBankNamed).toBe(true);
  });
});
