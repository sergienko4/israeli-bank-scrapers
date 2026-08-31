#!/usr/bin/env node
/**
 * Assert that every Pipeline guardrail selector is actually armed on every
 * production Pipeline file.
 *
 * Why this script exists: `eslint.config.mjs` §6 installs
 * `RESTRICTED_SYNTAX_RULES_NEW` — 45 architecture selectors, the richest
 * guardrail set in the repo — on `src/Scrapers/Pipeline/**`. §14 then
 * installs the 27-selector legacy set on `src/**\/*.ts`. Flat config
 * *replaces* rule options rather than merging them, and §14 sorts after
 * §6 while matching a superset of its files, so §14 wins everywhere the
 * two overlap. The 23 selectors unique to `_NEW` therefore resolved to
 * nothing on production code: no `else` ban, no `Promise.any` ban, no
 * `as never` ban, no DI enforcement.
 *
 * Both blocks landed together on 2026-05-31 (`7d52e9ff`), so the set was
 * never armed at any commit. Nothing caught it for two reasons that
 * reinforce each other. Reading the config bottom-up suggests the rules
 * are present — the selectors are right there in the source, and grep
 * confirms it. And the canaries built to detect exactly this were passing
 * on *incidental* lint findings (`jsdoc/require-jsdoc` and friends) rather
 * than on the rule they exist to prove, because `verify.sh` only checks
 * the targeted rule for canaries that opt in via `canary-expects-rule`.
 *
 * Grep cannot answer this question and neither can reading. Only the
 * resolved configuration can, which is what this gate reads. It is the
 * measurement instrument for a class of defect — flat-config override
 * collisions — that is invisible to every other gate in the repo.
 *
 * Scope, stated honestly: this verifies that each armed selector is
 * *present* in the resolved options. It does not verify that the selector
 * matches anything useful, nor that its message is accurate. A selector
 * that is present but silently mistyped still passes here and is caught
 * instead by its canary.
 *
 * Usage:
 *   node scripts/check-syntax-guardrails.mjs
 *
 * Exit codes:
 *   0  every armed selector resolves on every production Pipeline file
 *   1  at least one file is missing at least one armed selector
 *   2  the contract could not be read (config unreadable / no files found)
 */
import { ESLint } from 'eslint';
import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { exit, stderr, stdout } from 'node:process';

import {
  CANARY_EXTRA_SELECTORS,
  PIPELINE_ARMED_SELECTORS,
  PIPELINE_CANARY_SELECTORS,
  PIPELINE_KNOWN_NEW_SELECTORS,
  PIPELINE_LEGACY_SELECTORS,
  PIPELINE_PENDING_DRAIN_SELECTORS,
  PIPELINE_SELECTOR_EXEMPTIONS,
  scopedSelectorsForFile,
} from '../eslint.config.mjs';

/** Root of the guarded tree. Everything under it must carry the contract. */
const PIPELINE_ROOT = join('src', 'Scrapers', 'Pipeline');

/** Canary fixtures. Held to their own contract — see `checkCanaries`. */
const CANARY_ROOT = join(PIPELINE_ROOT, 'EslintCanaries');

/**
 * Subtrees outside the *production* contract.
 *
 * `EslintCanaries` holds fixtures that exist to *violate* rules, so they carry
 * a different — strictly larger — contract of their own. They are checked by
 * `checkCanaries` rather than skipped: a canary that quietly loses the
 * selector it certifies is precisely the failure this gate was built for.
 */
const EXEMPT_SEGMENTS = ['EslintCanaries'];

/**
 * Offenders printed before the report truncates. A layering regression hits
 * every file in the tree at once, so an untruncated list would bury the one
 * line that matters — the selector name — under hundreds of paths.
 */
const MAX_REPORTED = 8;

/**
 * Collect every TypeScript file beneath a directory.
 * @param dir - Directory to walk.
 * @param out - Accumulator, for recursion.
 * @returns Absolute-or-relative paths of every `.ts` file found.
 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * Whether a path is held to the production contract.
 * @param path - Repo-relative file path.
 * @returns True when no exempt segment appears in the path.
 */
function isGuarded(path) {
  const segments = path.split(sep);
  return !EXEMPT_SEGMENTS.some(segment => segments.includes(segment));
}

/**
 * Read the selectors ESLint will actually apply to a file.
 *
 * Options are `['error', ...entries]` where an entry is either a bare
 * selector string or `{ selector, message }`. Both spellings are in use.
 * @param eslint - Configured ESLint instance.
 * @param path - File to resolve configuration for.
 * @returns Selector strings in the resolved `no-restricted-syntax` options.
 */
async function resolvedSelectors(eslint, path) {
  const config = await eslint.calculateConfigForFile(path);
  const options = config.rules?.['no-restricted-syntax'] ?? [];
  return options.slice(1).map(entry => (typeof entry === 'string' ? entry : entry.selector));
}

/**
 * Selectors a specific file is allowed to be missing.
 *
 * The exemption table is the *only* sanctioned hole in the contract, and it
 * is deliberately per-file and per-selector: `'no-restricted-syntax': 'off'`
 * excuses one selector by lifting all sixty-one, which is how the PII
 * redactor's own type module ended up with no guardrails at all.
 * @param path - Repo-relative file path, in OS-native separators.
 * @returns Selector strings this file may legitimately lack.
 */
function exemptSelectors(path) {
  return PIPELINE_SELECTOR_EXEMPTIONS[path.split(sep).join('/')] ?? [];
}

/**
 * Group files by the armed selector they are missing.
 *
 * Keyed by selector rather than by file because the failure is a property of
 * the *configuration*, not of any one source file. One missing selector across
 * 700 files is a single defect and should read as one.
 *
 * The expected set is the global contract PLUS whatever scoped blocks (§12C)
 * contribute to that file. Checking only the global set is what let the
 * exemption blocks drop `LOWER_KEYS_ARRAY_RULE` on the three canonical-10
 * files while this gate still reported success.
 * @param eslint - Configured ESLint instance.
 * @param files - Guarded files to check.
 * @returns Map of selector to the paths missing it.
 */
async function collectGaps(eslint, files) {
  const gaps = new Map();
  for (const path of files) {
    const present = new Set(await resolvedSelectors(eslint, path));
    const exempt = new Set(exemptSelectors(path));
    const expected = [
      ...PIPELINE_ARMED_SELECTORS,
      ...scopedSelectorsForFile(path.split(sep).join('/')),
    ];
    for (const selector of expected) {
      if (present.has(selector) || exempt.has(selector)) continue;
      if (!gaps.has(selector)) gaps.set(selector, []);
      gaps.get(selector).push(path);
    }
  }
  return gaps;
}

/**
 * Group canary fixtures by the selector they were promised but did not get.
 *
 * Canaries are the only files in the repo whose *purpose* is to fail lint, so
 * a canary silently losing its selector looks identical to a canary working
 * correctly: both are red. The distinguishing question — red *on what?* — can
 * only be answered from the resolved config, which is what this reads.
 *
 * A canary needs the full undrained contract (so a queued selector stays
 * provably alive) plus any file-specific selector it exists to certify.
 * @param eslint - Configured ESLint instance.
 * @param files - Canary fixture paths.
 * @returns Map of selector to the canary paths missing it.
 */
async function collectCanaryGaps(eslint, files) {
  const gaps = new Map();
  for (const path of files) {
    const present = new Set(await resolvedSelectors(eslint, path));
    const key = path.split(sep).join('/');
    const want = [...PIPELINE_CANARY_SELECTORS, ...(CANARY_EXTRA_SELECTORS[key] ?? [])];
    for (const selector of want) {
      if (present.has(selector)) continue;
      if (!gaps.has(selector)) gaps.set(selector, []);
      gaps.get(selector).push(path);
    }
  }
  return gaps;
}

function reportGap(selector, paths) {
  stdout.write(`\n  ✗ ${selector}\n`);
  stdout.write(`    missing on ${paths.length} file(s), e.g.\n`);
  for (const path of paths.slice(0, MAX_REPORTED)) stdout.write(`      ${path}\n`);
}

/**
 * Prove every drain-queue entry names a selector that actually exists.
 *
 * The queue works by *subtraction*: an entry removes its selector from the
 * armed set. A typo therefore fails silently in the safe-looking direction —
 * the selector stays armed, so nothing breaks today — right up until someone
 * "fixes" the typo and disarms a live guardrail without review. Worse, a
 * selector parked here under a name that matches nothing would read as
 * queued-for-drain forever while never having been a real rule.
 * @returns Queue entries that are not members of `RESTRICTED_SYNTAX_RULES_NEW`.
 */
function unknownDrainEntries() {
  const known = new Set(PIPELINE_KNOWN_NEW_SELECTORS);
  return PIPELINE_PENDING_DRAIN_SELECTORS.filter(selector => !known.has(selector));
}

/**
 * Prove no drain-queue entry names a selector enforced across all of `src`.
 *
 * The queue is meant to hold Pipeline-only selectors on their way out. A
 * repo-wide selector landing here would be removed from the Pipeline set while
 * the rest of the tree still obeys it — a Pipeline-shaped hole in a live rule,
 * which `eslint-rules-guidlines.md` §1 forbids. `PIPELINE_KNOWN_NEW_SELECTORS`
 * documents this exclusion in prose; the two sets are nevertheless built from
 * different arrays, and nothing but this check stops them converging on the
 * same selector string.
 * @returns Queue entries that are members of `RESTRICTED_SYNTAX_RULES`.
 */
function legacyDrainEntries() {
  const legacy = new Set(PIPELINE_LEGACY_SELECTORS);
  return PIPELINE_PENDING_DRAIN_SELECTORS.filter(selector => legacy.has(selector));
}

/**
 * Prove every exemption names a selector that is actually armed.
 *
 * An exemption for an unarmed selector is at best dead weight and at worst a
 * typo that reads as a granted hole while granting nothing — so the file it
 * covers keeps failing for a reason the table appears to have addressed.
 * @returns `file → selector` pairs whose selector is not in the armed set.
 */
function unknownExemptions() {
  const armed = new Set(PIPELINE_ARMED_SELECTORS);
  return Object.entries(PIPELINE_SELECTOR_EXEMPTIONS).flatMap(([path, selectors]) =>
    selectors.filter(selector => !armed.has(selector)).map(selector => `${path} → ${selector}`),
  );
}

/**
 * Prove every declared canary extra names a file that exists.
 *
 * A typo'd path grants a selector to nothing while reading as coverage, so the
 * canary it was meant to arm stays dead behind an entry that appears to fix it.
 * @param canaries - Canary paths found on disk.
 * @returns Keys of `CANARY_EXTRA_SELECTORS` with no matching file.
 */
function unknownCanaryPaths(canaries) {
  const known = new Set(canaries.map(path => path.split(sep).join('/')));
  return Object.keys(CANARY_EXTRA_SELECTORS).filter(path => !known.has(path));
}

const files = walk(PIPELINE_ROOT).filter(isGuarded);
if (files.length === 0) {
  stderr.write(`check-syntax-guardrails: no files found under ${PIPELINE_ROOT}\n`);
  exit(2);
}

const eslint = new ESLint();
const gaps = await collectGaps(eslint, files);
const canaries = walk(CANARY_ROOT).filter(path => path.endsWith('.canary.ts'));
// `**/EslintCanaries/**` is a global ignore, so the default instance resolves
// no config for them at all — mirroring `verify.sh`'s own `--no-ignore`.
const canaryEslint = new ESLint({ ignore: false });
const canaryGaps = await collectCanaryGaps(canaryEslint, canaries);
const strays = [...unknownDrainEntries(), ...unknownExemptions(), ...unknownCanaryPaths(canaries)];

stdout.write(
  `check-syntax-guardrails: ${PIPELINE_ARMED_SELECTORS.length} armed selector(s) ` +
    `× ${files.length} production file(s), ` +
    `${PIPELINE_CANARY_SELECTORS.length} canary selector(s) × ${canaries.length} canaries, ` +
    `${PIPELINE_PENDING_DRAIN_SELECTORS.length} queued for drain, ` +
    `${Object.keys(PIPELINE_SELECTOR_EXEMPTIONS).length} file exemption(s)\n`,
);

const drainable = legacyDrainEntries();
if (drainable.length > 0) {
  for (const selector of drainable) {
    stdout.write(`\n  ✗ queued for drain but enforced repo-wide: ${selector}\n`);
  }
  stderr.write(
    `\ncheck-syntax-guardrails: ${drainable.length} drain entr(y|ies) name a repo-wide selector.\n` +
      'Draining one carves a Pipeline-shaped hole in a rule the rest of `src`\n' +
      'still obeys. Remove it from the queue, or retire the rule everywhere.\n',
  );
  exit(1);
}

if (strays.length > 0) {
  for (const selector of strays) stdout.write(`\n  ✗ names no real selector: ${selector}\n`);
  stderr.write(
    `\ncheck-syntax-guardrails: ${strays.length} entr(y|ies) name no real selector.\n` +
      'Drain-queue entries must appear verbatim in RESTRICTED_SYNTAX_RULES_NEW or\n' +
      'PIPELINE_REVIEW_RULES, the two sources PIPELINE_KNOWN_NEW_SELECTORS spreads;\n' +
      'exemptions must name a selector that is actually armed;\n' +
      'canary extras must name a canary that exists on disk.\n',
  );
  exit(1);
}

if (gaps.size === 0 && canaryGaps.size === 0) {
  stdout.write('check-syntax-guardrails: every armed selector resolves ✓\n');
  exit(0);
}

for (const [selector, paths] of gaps) reportGap(selector, paths);
for (const [selector, paths] of canaryGaps) reportGap(`[canary] ${selector}`, paths);
stderr.write(
  `\ncheck-syntax-guardrails: ${gaps.size + canaryGaps.size} armed selector(s) do not resolve.\n`,
);
stderr.write(
  'A later config block is replacing the Pipeline `no-restricted-syntax` options.\n' +
    'Flat config replaces rule options — it does not merge them. Narrow the\n' +
    'offending block with `ignores`, or fold its selectors into the Pipeline block.\n',
);
exit(1);
