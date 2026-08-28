/**
 * Guardrail and public-surface measurements.
 *
 * These complement the coupling numbers: they answer "did the safety net get
 * stronger or weaker?" alongside "did the structure get looser?".
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { stripComments } from './strip-comments.mjs';

const ANY_RE = /:\s*any\b|<any>|as\s+any\b/g;
const RULE_RE = /^\s*'([\w@/-]+(?:\/[\w-]+)*)':\s*\[?\s*'(?:error|warn)'/gm;

function countIn(root, files, re) {
  let total = 0;
  for (const f of files) {
    const code = stripComments(readFileSync(join(root, f), 'utf8'));
    total += (code.match(re) ?? []).length;
  }
  return total;
}

function countCanaries(root) {
  const dir = join(root, 'src/Scrapers/Pipeline/EslintCanaries');
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(f => f.endsWith('.canary.ts')).length;
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
 */
function countEslintRules(root) {
  const cfg = join(root, 'eslint.config.mjs');
  if (!existsSync(cfg)) return 0;
  const names = new Set();
  for (const match of readFileSync(cfg, 'utf8').matchAll(RULE_RE)) names.add(match[1]);
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
  return {
    canaries: countCanaries(root),
    eslintRules: countEslintRules(root),
    anyUsages: countIn(root, files, ANY_RE),
    publicSurface: publicSurface(root),
  };
}
