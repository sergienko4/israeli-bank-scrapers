/**
 * Guardrail and public-surface measurements.
 *
 * These complement the coupling numbers: they answer "did the safety net get
 * stronger or weaker?" alongside "did the structure get looser?".
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { stripComments } from './strip-comments.mjs';

const ANY_RE = /:\s*any\b|<any>|as\s+any\b/g;
const RULE_RE = /^\s*'([\w@/-]+(?:\/[\w-]+)*)':\s*\[?\s*'(?:error|warn)'/gm;
/** `import <clause> from '<specifier>'`, possibly spread over several lines. */
const IMPORT_FROM_RE = /^[ \t]*import\s+([^'"]+?)\s+from\s*['"]([^'"]+)['"]/gm;
/** `export <clause> from '<specifier>'` — a re-export applies its target. */
const REEXPORT_FROM_RE = /^[ \t]*export\s+(?:\*|\{[^}]*\})\s+from\s*['"]([^'"]+)['"]/gm;
/** `import '<specifier>'` — a side-effect import applies its target. */
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;
/** One JavaScript identifier. */
const IDENT_RE = /[A-Za-z_$][\w$]*/g;

function countIn(root, files, re) {
  let total = 0;
  for (const f of files) {
    const code = stripComments(readFileSync(join(root, f), 'utf8'));
    total += (code.match(re) ?? []).length;
  }
  return total;
}

function canaryFiles(root) {
  const dir = join(root, 'src/Scrapers/Pipeline/EslintCanaries');
  if (!existsSync(dir)) return {};
  const names = readdirSync(dir)
    .filter(f => f.endsWith('.canary.ts'))
    .sort();
  return Object.fromEntries(names.map(name => [name, canaryHash(dir, name)]));
}

function canaryHash(dir, name) {
  const content = readFileSync(join(dir, name));
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Distinct ESLint rules enforced at `error` or `warn`.
 *
 * Counts rule NAMES, not declaration lines. Counting lines made *widening* a
 * rule read as a regression: replacing two narrowly-scoped declarations with a
 * single broader one drops the line count while strictly increasing coverage,
 * so the ratchet blocked exactly the change it exists to encourage.
 *
 * The trade-off is deliberate. This config declares some rules many times with
 * different per-cluster options (`max-lines`, `max-lines-per-function`), and a
 * name-based count no longer notices one of those scoped declarations being
 * deleted. `lint:guideline-coverage` closes that gap for the four numeric caps:
 * it resolves the effective config for EVERY production file under
 * `src/Common` and `src/Scrapers` and fails when a cap does not match the
 * expectation recorded across `src/Tests/Tools/CapRegimeTable.ts` (the policy
 * anchor) and `src/Tests/Tools/CapOverrides.ts` (the per-path exceptions)
 * exactly. The unit is the file, not the
 * directory, because this config also scopes caps to individual filenames
 * beside a differently-capped sibling directory; sampling one file per
 * directory would leave those regimes unmeasured. Deleting a scoped
 * declaration changes the resolved cap of every file it governed, so that
 * gate names each affected file and rule and exits non-zero.
 *
 * It is not a complete substitute, and the residue is worth stating plainly.
 * That gate checks four rules: `max-lines`, `max-lines-per-function`,
 * `complexity` and `@typescript-eslint/max-params`. A scoped
 * `no-restricted-syntax` or `max-statements` declaration can still be deleted
 * without either measure noticing, and so can any other rule. Telling
 * "consolidated, so scope widened" apart from "deleted, so scope shrank" needs
 * glob resolution, which no text count can do. What stays with this ratchet is
 * the coarse question it answers reliably: did a rule disappear altogether?
 *
 * "Reachable" is therefore part of the measurement, and so is "applied".
 * Counting every module reachable by import is not enough: an import whose
 * binding is never used is green text a linter may even flag, and the config
 * does not apply it. The walk therefore follows only imports whose bindings
 * are actually referenced outside the import statements — spread into a block
 * array, passed as an argument, or re-exported. That is the closest a text
 * read gets to "this module's rules reach the exported configuration", and it
 * catches both ways a cluster can be disconnected: the import removed, and the
 * import kept while its spread is deleted.
 */

/**
 * Local names an import clause binds.
 *
 * Handles the three clause shapes the config uses: a default import, a named
 * list (with or without `as` aliases), and `* as namespace`. Any other token
 * in the clause (`type`, punctuation) is ignored.
 * @param {string} clause - Text between `import` and `from`.
 * @returns {string[]} Local binding names introduced by the clause.
 */
function bindingsOf(clause) {
  const names = [];
  const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
  if (namespace) names.push(namespace[1]);
  const named = /\{([^}]*)\}/.exec(clause);
  if (named) {
    for (const entry of named[1].split(',')) {
      const alias = /\bas\s+([A-Za-z_$][\w$]*)/.exec(entry);
      const name = (alias ? alias[1] : entry).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  const rest = clause.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+[A-Za-z_$][\w$]*/, '');
  for (const part of rest.split(',')) {
    const name = part.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
  }
  return names;
}

/**
 * Names a module body references, with every import/export-from removed.
 *
 * Stripping the statements first is what makes the check meaningful: an
 * imported binding mentioned only by its own import line does not count as
 * used, which is exactly the "import kept, spread deleted" case.
 * @param {string} code - Comment-stripped module source.
 * @returns {Set<string>} Identifiers that appear outside import statements.
 */
function referencedNames(code) {
  const body = code
    .replace(IMPORT_FROM_RE, '')
    .replace(REEXPORT_FROM_RE, '')
    .replace(SIDE_EFFECT_IMPORT_RE, '');
  return new Set(body.match(IDENT_RE) ?? []);
}

/**
 * Relative modules a module actually applies.
 *
 * An `import … from` counts only when at least one of its bindings is
 * referenced in the body; a re-export or side-effect import always counts,
 * because both apply the target by definition.
 * @param {string} code - Comment-stripped module source.
 * @returns {string[]} Relative specifiers the module applies, in source order.
 */
function appliedImports(code) {
  const names = referencedNames(code);
  const applied = [];
  for (const match of code.matchAll(IMPORT_FROM_RE)) {
    if (bindingsOf(match[1]).some(name => names.has(name))) applied.push(match[2]);
  }
  for (const re of [REEXPORT_FROM_RE, SIDE_EFFECT_IMPORT_RE]) {
    for (const match of code.matchAll(re)) applied.push(match[1]);
  }
  return applied.filter(specifier => specifier.startsWith('.'));
}

/**
 * Resolve the modules the flat-config entry actually applies.
 *
 * A module that is left on disk, or imported but never spread, contributes no
 * rule to the effective config, so it must not contribute to the ratchet.
 * @param {string} root - Repository root.
 * @returns {string[]} Entry file plus every applied local module.
 */
function appliedConfigFiles(root) {
  const entry = join(root, 'eslint.config.mjs');
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const specifier of appliedImports(code)) {
      const target = resolve(dirname(file), specifier);
      if (!seen.has(target)) pending.push(target);
    }
  }
  return [...seen];
}

/**
 * Count distinct rule names declared by the applied ESLint configuration.
 *
 * A ratchet on this number answers one question: did a rule disappear
 * altogether? It cannot tell narrowed scope from deletion; that needs glob
 * resolution, which no text read can do.
 * @param {string} root - Repository root.
 * @returns {number} Distinct rule names declared across applied modules.
 */
function countEslintRules(root) {
  const files = appliedConfigFiles(root).filter(file => existsSync(file));
  const names = new Set();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(RULE_RE)) names.add(match[1]);
  }
  return names.size;
}

function publicSurface(root) {
  const bundle = join(root, 'lib/index.cjs');
  if (!existsSync(bundle)) return { present: false, sha256: null, bytes: 0 };
  const buf = readFileSync(bundle);
  return {
    present: true,
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: statSync(bundle).size,
  };
}

/** Snapshot of guardrail strength and the published public surface. */
export function guardrails(root, files) {
  const inventory = canaryFiles(root);
  return {
    canaries: Object.keys(inventory).length,
    canaryFiles: inventory,
    eslintRules: countEslintRules(root),
    anyUsages: countIn(root, files, ANY_RE),
    publicSurface: publicSurface(root),
  };
}
