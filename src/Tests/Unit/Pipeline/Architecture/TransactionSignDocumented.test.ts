/**
 * Guards the documentation of coded transaction directions.
 *
 * `TxnSign` decides whether a provider's amount is money in or money out. When
 * a provider states that direction as an opaque integer, the meaning of that
 * integer lives only in `DIRECTION_CODE_CONVENTIONS` — a reader of the raw
 * payload cannot infer it. This suite fails when a convention is registered,
 * changed or removed without the matching edit to the page that explains it.
 *
 * The conventions are read from the real declaration with the TypeScript
 * compiler API rather than by matching source text, so a row that is reflowed,
 * reordered or given a trailing comma is still decoded. Any element that cannot
 * be decoded fails the suite outright — silently skipping it would let an
 * undocumented convention pass behind the rows that happen to be readable.
 *
 * The documented codes are matched by table column, not by loose token search,
 * so a page that lists both codes in the wrong order fails rather than passing
 * on the strength of containing the right digits somewhere.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';

import enrolledSources from '../../../Helpers/DocsFrontMatter.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');

/** Enrolment path, exactly as a docs page must spell it in `source-files:`. */
const SIGN_MODULE = 'src/Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnSign.ts';

/** The declaration that names every coded direction the pipeline understands. */
const TABLE_NAME = 'DIRECTION_CODE_CONVENTIONS';

/** Column headings the canonical table must carry, in any order. */
const HEADINGS = ['Field', 'Inbound code', 'Outbound code'] as const;

interface IConvention {
  readonly field: string;
  readonly inbound: string;
  readonly outbound: string;
}

/**
 * Strips `as const` and `satisfies` wrappers from an initializer.
 *
 * @param node - The initializer as written in the source.
 * @returns The expression the wrappers were applied to.
 */
function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node)) return unwrap(node.expression);
  if (ts.isSatisfiesExpression(node)) return unwrap(node.expression);
  return node;
}

/**
 * Collects every variable declaration in a parsed file, at any depth.
 *
 * @param node - The node to search, normally a source file.
 * @returns Each declaration found, in source order.
 */
function declarationsIn(node: ts.Node): readonly ts.VariableDeclaration[] {
  const here = ts.isVariableDeclaration(node) ? [node] : [];
  const deeper = node.getChildren().flatMap(declarationsIn);
  return [...here, ...deeper];
}

/**
 * Reads the elements of a declaration's array initializer.
 *
 * @param decl - The declaration to read.
 * @returns Its elements, or an empty list when it initializes no array.
 */
function elementsOf(decl: ts.VariableDeclaration): readonly ts.Expression[] {
  const init = decl.initializer;
  if (init === undefined) return [];
  const inner = unwrap(init);
  if (!ts.isArrayLiteralExpression(inner)) return [];
  return [...inner.elements];
}

/**
 * Reads one named property's literal initializer.
 *
 * @param object - The object literal to read the property from.
 * @param key - The property name to look for.
 * @returns The literal's value, or an empty string when it is absent.
 */
function literalOf(object: ts.ObjectLiteralExpression, key: string): string {
  const assignments = object.properties.filter(ts.isPropertyAssignment);
  const match = assignments.find((p): boolean => p.name.getText() === key);
  const init = match?.initializer;
  if (init === undefined) return '';
  if (ts.isStringLiteral(init)) return init.text;
  return init.getText();
}

/**
 * Decodes one registered convention.
 *
 * @param element - One element of the conventions array.
 * @returns The row's three values; any that could not be read is empty.
 */
function decodeRow(element: ts.Expression): IConvention {
  if (!ts.isObjectLiteralExpression(element)) {
    return { field: '', inbound: '', outbound: '' };
  }
  const field = literalOf(element, 'field');
  const inbound = literalOf(element, 'inbound');
  const outbound = literalOf(element, 'outbound');
  return { field, inbound, outbound };
}

/**
 * Reports a row the decoder could not fully read.
 *
 * @param row - The decoded convention.
 * @returns True when any of its three values is missing.
 */
function isUndecodable(row: IConvention): boolean {
  if (row.field === '') return true;
  if (row.inbound === '') return true;
  return row.outbound === '';
}

/**
 * Reads every convention registered in the real source file.
 *
 * @returns One entry per element of the conventions array.
 */
function registeredConventions(): readonly IConvention[] {
  const file = path.join(REPO_ROOT, ...SIGN_MODULE.split('/'));
  const raw = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true);
  const declared = declarationsIn(source);
  const table = declared.filter((d): boolean => d.name.getText() === TABLE_NAME);
  return table.flatMap(elementsOf).map(decodeRow);
}

/**
 * Lists every markdown page under `docs/`.
 *
 * @returns Paths relative to `docs/`, always POSIX-separated.
 */
function docPages(): readonly string[] {
  const entries = fs.readdirSync(DOCS_DIR, { recursive: true, encoding: 'utf8' });
  const markdown = entries.filter((e): boolean => e.endsWith('.md'));
  return markdown.map((e): string => e.split(path.sep).join('/'));
}

/**
 * Reads one docs page from disk.
 *
 * @param relative - The page's path relative to `docs/`, POSIX-separated.
 * @returns The page's full text.
 */
function readPage(relative: string): string {
  const segments = relative.split('/');
  const file = path.join(DOCS_DIR, ...segments);
  return fs.readFileSync(file, 'utf8');
}

/**
 * Finds the pages that enrol the sign module for the staleness gate.
 *
 * @returns Each enrolling page's path mapped to its text.
 */
function enrollingPages(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const relative of docPages()) {
    const text = readPage(relative);
    const sources = enrolledSources(text);
    if (sources.includes(SIGN_MODULE)) found.set(relative, text);
  }
  return found;
}

/**
 * Splits one markdown table line into its cells.
 *
 * @param line - A single line of a page.
 * @returns The trimmed cells, including the empties either side.
 */
function cellsOf(line: string): readonly string[] {
  return line.split('|').map((cell): string => cell.trim());
}

/**
 * Recognises the heading row of the canonical table.
 *
 * @param cells - One row's cells.
 * @returns True when every required heading is present.
 */
function isHeading(cells: readonly string[]): boolean {
  return HEADINGS.every((heading): boolean => cells.includes(heading));
}

/**
 * Locates the canonical table's columns within a page.
 *
 * @param rows - Every line of the page, already split into cells.
 * @returns The index of each required heading, or an empty list when absent.
 */
function columnsOf(rows: readonly (readonly string[])[]): readonly number[] {
  const heading = rows.find(isHeading);
  if (heading === undefined) return [];
  return HEADINGS.map((name): number => heading.indexOf(name));
}

/**
 * Matches one table row against one convention, column by column.
 *
 * @param cells - The row's cells.
 * @param cols - Indices of the field, inbound and outbound columns.
 * @param row - The convention the row must state.
 * @returns True when the row names the field and both codes in place.
 */
function rowStates(cells: readonly string[], cols: readonly number[], row: IConvention): boolean {
  const field = (cells.at(cols[0]) ?? '').trim();
  if (field !== row.field && field !== `\`${row.field}\``) return false;
  const inbound = cells.at(cols[1]) ?? '';
  if (inbound !== row.inbound) return false;
  return (cells.at(cols[2]) ?? '') === row.outbound;
}

/**
 * Checks a page's canonical table for one convention.
 *
 * @param text - The page's full text.
 * @param row - The convention to look for.
 * @returns True when the table states it exactly.
 */
function documents(text: string, row: IConvention): boolean {
  const rows = text.split(/\r?\n/).map(cellsOf);
  const cols = columnsOf(rows);
  if (cols.length !== HEADINGS.length) return false;
  return rows.some((cells): boolean => rowStates(cells, cols, row));
}

describe('coded transaction directions are documented', () => {
  it('reads every registered convention from the source declaration', () => {
    const conventions = registeredConventions();
    expect(conventions.length).toBeGreaterThan(0);
    const undecodable = conventions.filter(isUndecodable);
    expect(undecodable).toEqual([]);
  });

  it('enrols the sign module in a docs page so the staleness gate covers it', () => {
    const pages = enrollingPages();
    expect([...pages.keys()]).not.toEqual([]);
  });

  it('states each convention in a canonical table on an enrolling page', () => {
    const pages = [...enrollingPages().values()];
    const conventions = registeredConventions();
    const missing = conventions.filter((row): boolean => {
      return !pages.some((text): boolean => documents(text, row));
    });
    expect(missing).toEqual([]);
  });
});
