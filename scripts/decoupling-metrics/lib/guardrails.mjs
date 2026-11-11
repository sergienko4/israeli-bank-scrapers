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
const FROM_IMPORT_RE = /\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /^\s*import\s*['"]([^'"]+)['"]/gm;

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
 * "Reachable" is therefore part of the measurement. Only modules imported
 * (transitively) from `eslint.config.mjs` are counted: once a cluster is
 * disconnected, its rule declarations no longer govern anything, so scanning
 * the directory would keep crediting rules the config never applies.
 */

/**
 * List the relative module specifiers imported or re-exported by `code`.
 * @param {string} code - Module source with comments stripped.
 * @returns {string[]} Relative specifiers in source order.
 */
function localImports(code) {
  const specifiers = [];
  for (const re of [FROM_IMPORT_RE, SIDE_EFFECT_IMPORT_RE]) {
    for (const match of code.matchAll(re)) {
      if (match[1].startsWith('.')) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/**
 * Resolve module files reachable from the flat-config entry through relative
 * imports. A cluster left on disk but no longer spread by the entry is not
 * reachable, so its rules stop counting toward the ratchet.
 * @param {string} root - Repository root.
 * @returns {string[]} Entry file plus every reachable local module.
 */
function eslintConfigFiles(root) {
  const entry = join(root, 'eslint.config.mjs');
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const specifier of localImports(code)) {
      const target = resolve(dirname(file), specifier);
      if (!seen.has(target)) pending.push(target);
    }
  }
  return [...seen];
}

function countEslintRules(root) {
  const files = eslintConfigFiles(root).filter(file => existsSync(file));
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
