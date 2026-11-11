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
/** `export * as <name> from '<specifier>'` — names the target's whole surface. */
const REEXPORT_NAMESPACE_RE =
  /^[ \t]*export\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/gm;
/** `export * from '<specifier>'` — passes every named export through. */
const REEXPORT_STAR_RE = /^[ \t]*export\s*\*\s+from\s*['"]([^'"]+)['"]/gm;
/** `export { a, b as c } from '<specifier>'` — exposes only the listed names. */
const REEXPORT_NAMED_RE = /^[ \t]*export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm;
/** `import '<specifier>'` — a side-effect import applies its target. */
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;
/** One JavaScript identifier. */
const IDENT_RE = /[A-Za-z_$][\w$]*/g;
/** Every statement that neither reads nor declares a body binding. */
const STATEMENT_RES = [
  IMPORT_FROM_RE,
  REEXPORT_NAMESPACE_RE,
  REEXPORT_STAR_RE,
  REEXPORT_NAMED_RE,
  SIDE_EFFECT_IMPORT_RE,
];

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
 *
 * Re-exports need the same test, and a stronger one. `export *` and
 * `export { default } from` are how a barrel hands its blocks to the config, so
 * they keep applying whenever the names they expose are wanted. A named
 * re-export such as `export { metadata } from` exposes a name the default
 * configuration never reads; keeping that compatibility line beside a deleted
 * block would otherwise keep crediting the block's rules. The walk therefore
 * carries the set of exported names each consumer needs and follows a re-export
 * only for the names in that set.
 */

/**
 * Parse an import clause into the names it requests and the names it binds.
 *
 * `import Def, { a, b as c }` yields three entries; `import * as ns` yields one
 * with `imported: '*'`. The imported name is what the target must export; the
 * local name is what the body must mention for the import to apply.
 * @param {string} clause - Text between `import` and `from`.
 * @returns {Array<{ imported: string, local: string }>} Clause entries in source order.
 */
function importEntries(clause) {
  /** @type {Array<{ imported: string, local: string }>} */
  const entries = [];
  const named = /\{([^}]*)\}/.exec(clause);
  if (named) {
    for (const raw of named[1].split(',')) {
      const text = raw.replace(/^\s*type\s+/, '').trim();
      const alias = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(text);
      if (alias) entries.push({ imported: alias[1], local: alias[2] });
      else if (/^[A-Za-z_$][\w$]*$/.test(text)) entries.push({ imported: text, local: text });
    }
  }
  const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
  if (namespace) entries.push({ imported: '*', local: namespace[1] });
  const rest = clause.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+[A-Za-z_$][\w$]*/, '');
  for (const part of rest.split(',')) {
    const name = part.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) entries.push({ imported: 'default', local: name });
  }
  return entries;
}

/**
 * Parse a named re-export clause into exported-to-imported name pairs.
 *
 * The exported name is what a consumer asks this module for; the imported name
 * is what this statement asks the target for.
 * @param {string} clause - Text between `{` and `}`.
 * @returns {Array<{ imported: string, exported: string }>} Pairs in source order.
 */
function reexportEntries(clause) {
  /** @type {Array<{ imported: string, exported: string }>} */
  const entries = [];
  for (const raw of clause.split(',')) {
    const text = raw.replace(/^\s*type\s+/, '').trim();
    const alias = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(text);
    if (alias) entries.push({ imported: alias[1], exported: alias[2] });
    else if (/^[A-Za-z_$][\w$]*$/.test(text)) entries.push({ imported: text, exported: text });
  }
  return entries;
}

/**
 * Module source with every import and re-export statement removed.
 *
 * Stripping the statements is what makes the usage checks meaningful: a name
 * mentioned only by its own import line, or exposed only by its own re-export
 * line, does not count as read by the configuration.
 * @param {string} code - Comment-stripped module source.
 * @returns {string} Module body.
 */
function bodyOf(code) {
  let body = code;
  for (const re of STATEMENT_RES) body = body.replace(re, '');
  return body;
}

/**
 * Names read off a namespace import, or `null` when the namespace is used as a
 * value.
 *
 * `ns.A` and `ns.B` request exactly `A` and `B`. Spreading or forwarding `ns`
 * itself could reach any export, so it requests the whole surface.
 * @param {string} body - Module body with import/export statements removed.
 * @param {string} local - Namespace binding name.
 * @returns {Set<string> | null} Member names, or `null` for the whole surface.
 */
function namespaceMembers(body, local) {
  const members = new RegExp(`\\b${local}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
  const names = new Set();
  for (const match of body.matchAll(members)) names.add(match[1]);
  const leftover = new RegExp(`\\b${local}\\b`).test(body.replace(members, ''));
  return leftover ? null : names;
}

/**
 * Names one import statement requests from its target.
 *
 * Returns `null` when the target's whole export surface is needed, the imported
 * names of every binding the body mentions otherwise, and `undefined` when no
 * binding is mentioned and the statement therefore applies nothing.
 * @param {Array<{ imported: string, local: string }>} entries - Parsed clause.
 * @param {string} body - Module body with import/export statements removed.
 * @param {Set<string>} bodyNames - Identifiers the body references.
 * @returns {Set<string> | null | undefined} Requested names.
 */
function importRequest(entries, body, bodyNames) {
  const names = new Set();
  let everything = false;
  let used = false;
  for (const entry of entries) {
    if (!bodyNames.has(entry.local)) continue;
    used = true;
    if (entry.imported !== '*') {
      names.add(entry.imported);
      continue;
    }
    const members = namespaceMembers(body, entry.local);
    if (members === null) everything = true;
    else for (const member of members) names.add(member);
  }
  if (!used) return undefined;
  return everything ? null : names;
}

/**
 * Names one named re-export requests from its target.
 *
 * A re-export applies only the names a consumer actually asks for, so a
 * compatibility line kept beside a removed block contributes nothing.
 * @param {Array<{ imported: string, exported: string }>} entries - Parsed clause.
 * @param {Set<string> | null} wanted - Names the consumer needs from this module.
 * @returns {Set<string> | undefined} Requested names, or `undefined` when unused.
 */
function reexportRequest(entries, wanted) {
  const matched = entries.filter(entry => wanted === null || wanted.has(entry.exported));
  if (matched.length === 0) return undefined;
  return new Set(matched.map(entry => entry.imported));
}

/**
 * Resolve the modules the flat-config entry actually applies.
 *
 * The entry's default export is the configuration ESLint loads, so the walk
 * starts by asking for its `default` binding and carries the names each module
 * must export down through re-exports. A module that is left on disk, imported
 * but never spread, or reached only through a metadata re-export contributes no
 * rule to the effective config, so it must not contribute to the ratchet.
 * @param {string} root - Repository root.
 * @returns {string[]} Entry file plus every applied local module.
 */
function appliedConfigFiles(root) {
  const entry = join(root, 'eslint.config.mjs');
  /** Names each module must export; `null` means the whole surface. */
  const wanted = new Map([[entry, new Set(['default'])]]);
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!existsSync(file)) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    const body = bodyOf(code);
    const bodyNames = new Set(body.match(IDENT_RE) ?? []);
    const needs = wanted.get(file);
    /** @type {Array<{ specifier: string, names: Set<string> | null }>} */
    const targets = [];
    for (const match of code.matchAll(IMPORT_FROM_RE)) {
      const request = importRequest(importEntries(match[1]), body, bodyNames);
      if (request !== undefined) targets.push({ specifier: match[2], names: request });
    }
    for (const match of code.matchAll(SIDE_EFFECT_IMPORT_RE)) {
      targets.push({ specifier: match[1], names: null });
    }
    for (const match of code.matchAll(REEXPORT_NAMED_RE)) {
      const request = reexportRequest(reexportEntries(match[1]), needs);
      if (request !== undefined) targets.push({ specifier: match[2], names: request });
    }
    for (const match of code.matchAll(REEXPORT_STAR_RE)) {
      if (needs === null) {
        targets.push({ specifier: match[1], names: null });
        continue;
      }
      // `export *` never re-exports `default`, so a request for it alone does
      // not keep the target alive.
      const passthrough = new Set([...needs].filter(name => name !== 'default'));
      if (passthrough.size > 0) targets.push({ specifier: match[1], names: passthrough });
    }
    for (const match of code.matchAll(REEXPORT_NAMESPACE_RE)) {
      if (needs === null || needs.has(match[1])) {
        targets.push({ specifier: match[2], names: null });
      }
    }
    for (const { specifier, names } of targets) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      if (!existsSync(target)) continue;
      const previous = wanted.get(target);
      if (previous === null) continue;
      if (previous && names !== null && [...names].every(name => previous.has(name))) continue;
      if (previous && names !== null) for (const name of names) previous.add(name);
      else wanted.set(target, names);
      pending.push(target);
    }
  }
  return [...wanted.keys()];
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
