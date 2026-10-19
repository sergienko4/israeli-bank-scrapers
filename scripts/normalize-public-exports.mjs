import ts from 'typescript';

function hasRedundantTypeModifier(statement) {
  if (!ts.isExportDeclaration(statement) || !statement.isTypeOnly) return false;
  const clause = statement.exportClause;
  return clause && ts.isNamedExports(clause) && clause.elements.some(element => element.isTypeOnly);
}

/** Only the local named-export footer may change spelling without review. */
function isLocalExport(statement) {
  return (
    ts.isExportDeclaration(statement) &&
    !statement.moduleSpecifier &&
    !statement.attributes &&
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause)
  );
}

function exportEntries(statement) {
  return statement.exportClause.elements.map(element => [
    statement.isTypeOnly || element.isTypeOnly,
    (element.propertyName ?? element.name).getText(),
    element.name.getText(),
  ]);
}

function exportFooter(source) {
  const first = source.statements.findIndex(isLocalExport);
  const footer = first === -1 ? [] : source.statements.slice(first);
  return footer.every(isLocalExport) ? footer : [];
}

function sortedExportEntries(footer) {
  const entries = footer.flatMap(exportEntries);
  return entries.map(entry => JSON.stringify(entry)).sort();
}

function comparableFooter(text, source, footer) {
  const start = footer[0].getStart(source);
  const end = footer.at(-1).end;
  if (/\/[/*]/u.test(text.slice(start, end))) return JSON.stringify({ exact: text });
  const entries = sortedExportEntries(footer);
  const prefix = text.slice(0, start);
  const suffix = text.slice(end);
  return JSON.stringify({ prefix, entries, suffix });
}

/**
 * Preserve declarations verbatim while comparing local export identities.
 * Re-exports, comments and non-footer exports retain byte-exact comparison.
 * @param {string} text Declaration source.
 * @returns {string} Unambiguous serialized comparison.
 */
export function normalizePublicExports(text) {
  const source = ts.createSourceFile('surface.d.ts', text, ts.ScriptTarget.Latest, true);
  const invalid = source.parseDiagnostics.length || source.statements.some(hasRedundantTypeModifier);
  if (invalid) throw new SyntaxError('malformed declaration source');
  const footer = exportFooter(source);
  return footer.length ? comparableFooter(text, source, footer) : JSON.stringify({ exact: text });
}
