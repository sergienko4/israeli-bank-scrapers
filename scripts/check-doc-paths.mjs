#!/usr/bin/env node
/**
 * Assert that every repo-relative path cited in a Markdown file exists.
 *
 * Why this script exists: `CLAUDE.md` is the canonical rule source every
 * agent session loads, and its entire "Key Files" list rotted silently
 * when `src/` was restructured (`src/helpers/` -> `src/Common/`,
 * `src/scrapers/` -> `src/Scrapers/`). Seven of seven paths pointed at
 * files that no longer existed. Nothing caught it, because the paths are
 * inline code spans rather than Markdown links: `check-docs-links.sh`
 * only resolves published site URLs, and `mkdocs --strict` only sees
 * links inside `docs/`. An agent that trusts a phantom path wastes a
 * whole investigation on a file that is not there — which is exactly how
 * this gate came to be written.
 *
 * The same failure shape hits PR bodies (`pr-guidlines.md` §7 "What"):
 * a body that cites a path it never touched, or that survived a
 * mid-review change of approach, ships an inaccurate record. Passing
 * `--diff-base` additionally accepts paths that the diff *deletes*, so a
 * body may legitimately describe a file it is removing.
 *
 * Scope, stated honestly: this verifies that cited paths RESOLVE. It
 * cannot judge whether the surrounding prose is true. Semantic drift
 * (a body describing an abandoned strategy) remains a job for review.
 *
 * Usage:
 *   node scripts/check-doc-paths.mjs <file.md> [more.md ...]
 *   node scripts/check-doc-paths.mjs --diff-base origin/main .git/PR_BODY.md
 *
 * Exit codes:
 *   0  every cited path resolves
 *   1  at least one cited path does not resolve
 *   2  usage error (no files given / file unreadable)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';

/**
 * Inline-code spans, the only place we trust a token to be a real path.
 * Prose mentions are deliberately ignored to keep false positives at zero.
 */
const CODE_SPAN = /`([^`\n]+)`/g;

/**
 * A token is a candidate path when it looks repo-relative: it contains a
 * `/` and ends in a file extension. Bare directory names are skipped —
 * too many prose words ("src/") would masquerade as paths.
 */
const PATH_SHAPE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.[A-Za-z0-9]+$/;

/**
 * Prefixes that never live in this repo, so a citation of them is not a
 * broken path. `node_modules/` is installed, not committed.
 */
const IGNORED_PREFIXES = ['node_modules/', 'http://', 'https://', '.git/'];

/**
 * Reduce a path to one structural spelling for the checks that follow.
 *
 * Converts `\` to `/`, then drops empty and `.` segments everywhere except
 * index 0. A leading `.` is kept: it is what marks `./README.md` as a path
 * rather than prose, and `PATH_SHAPE` needs that slash to match. A leading
 * empty segment is kept too, so an absolute path stays absolute and is still
 * rejected downstream. `..` is never touched — the containment check must see
 * it.
 *
 * Dropping *trailing* separators is a deliberate leniency, not an oversight:
 * `Browser.ts/` reduces to `Browser.ts`. Under POSIX those denote different
 * things, so this is the one case where the spelling's meaning is not
 * preserved. It cannot admit a phantom path — a citation of a file that does
 * not exist still fails whether or not it carries a trailing slash — and
 * rejecting the form instead would report "path does not exist" against a file
 * that plainly does, which is the more misleading of the two failures.
 * @param entry - Path as written in a manifest or a document.
 * @returns Same path, forward slashes, no redundant separators or interior
 * `.` segments. A separator-only input reduces to the empty string, which
 * `PATH_SHAPE` then rejects.
 */
function normaliseSeparators(entry) {
  const parts = entry.split('\\').join('/').split('/');
  const kept = parts.filter((part, index) => index === 0 || (part !== '' && part !== '.'));
  return kept.join('/');
}

/**
 * Reduce a path to the one spelling everything downstream compares against.
 *
 * Three spellings denote the same file. A manifest writes `lib/index.cjs` for
 * `main` but must write `./lib/index.cjs` under `exports`; a document may cite
 * either; and a Windows author may write separators as `\`. Git, by contrast,
 * always reports one form — no prefix, forward slashes — so that is the form
 * chosen here.
 *
 * `existsSync`, the removed-path set and the ignored-prefix list all compare
 * against this. Canonicalising for only one of them is what made a `./`-spelled
 * deletion report as drift.
 *
 * Callers that also need to *recognise* the path must normalise separators
 * first and canonicalise only afterwards: stripping the `./` from a root-level
 * citation leaves a bare filename, which `PATH_SHAPE` deliberately rejects.
 * @param entry - Path as written in a manifest or a document.
 * @returns Repo-relative path: forward slashes, no leading `./`.
 */
function canonicalisePath(entry) {
  const normalised = normaliseSeparators(entry);
  return normalised.replace(/^\.\//, '');
}

/**
 * Collect every string *target* under `exports`, at any nesting depth.
 *
 * Deliberately reads values only. A subpath key such as `"./widget"` is a
 * public specifier, not a file on disk; exempting one would let a citation of
 * a nonexistent path pass and reinstate the fail-open behaviour this whole
 * change exists to remove.
 * @param node - An `exports` subtree: string, array, object, or null.
 * @returns Declared target paths, unnormalised.
 */
function exportTargets(node) {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(exportTargets);
  if (node !== null && typeof node === 'object') return Object.values(node).flatMap(exportTargets);
  return [];
}

/**
 * The published entry points, read from the manifest rather than listed here.
 *
 * These are build output: present on any machine that has run a build, absent
 * on a fresh CI checkout. A PR body asserting the published surface is
 * unchanged is a legitimate citation, and must not depend on whether a build
 * happens to have run — that is the pass-locally/fail-in-CI flake described
 * below, and it is what motivated this.
 *
 * Derived, not hardcoded, so the gate cannot drift from what npm actually
 * publishes. Exempting the whole `lib/` directory instead would be the easy
 * fix and the wrong one: it would silently accept a one-character typo in a
 * citation, turning something a reviewer wants flagged into a pass.
 * @returns Declared entry-point paths, repo-relative and canonical.
 */
function publishedEntryPoints() {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const fromExports = exportTargets(manifest.exports ?? {});
  const flat = [manifest.main, manifest.module, manifest.types];
  const declared = [...flat, ...fromExports].filter(entry => typeof entry === 'string');
  return declared.map(canonicalisePath);
}

/**
 * Artefacts created at run time, which a doc may legitimately cite while
 * they are absent. The PR-body handoff file is the motivating case: the
 * pre-push hook *searches* these locations, so documenting them is
 * correct even on a checkout where no PR is in flight. Without this the
 * gate would pass on a machine that happens to have one lying around and
 * fail in CI — a flake, which is worse than no gate at all.
 */
const OPTIONAL_PATHS = new Set(['.github/PR_BODY.md', ...publishedEntryPoints()]);

/**
 * Strip a trailing locator (`:42`, `:analyze`, `#L17`) so `file.ts:12` and
 * `file.ts#L17` both resolve against `file.ts`. The suffix itself is not
 * verified. Both forms appear in agent docs, and dropping the suffix is
 * cheaper than losing the coverage.
 * @param token - Raw inline-code token.
 * @returns Token without a trailing locator.
 */
function stripLocator(token) {
  const cut = [token.indexOf(':'), token.indexOf('#')].filter(i => i !== -1);
  return cut.length === 0 ? token : token.slice(0, Math.min(...cut));
}

/**
 * Whether a candidate stays inside the repository.
 *
 * The CI job scans PR-body text, which any contributor controls. Without this
 * a citation of `../../../etc/passwd` would report through the exit status and
 * output whether that file exists — a filesystem existence oracle. Paths are
 * repo-relative by definition here, so refusing to traverse upward costs
 * nothing.
 * @param token - Candidate path.
 * @returns True when the path resolves inside the repo root.
 */
function withinRepo(token) {
  if (token.split('/').includes('..')) return false;
  return !isAbsolute(token);
}

/**
 * Extract unique candidate paths from Markdown source.
 *
 * Code spans that serve as a Markdown link label — ``[`Banks/X.ts`](url)``
 * — are skipped. `docs/` deliberately shortens the label relative to a
 * documented base while the link target carries the full repo path, so
 * treating the label as repo-relative reports drift that is not there.
 *
 * Separators are normalised before the shape and containment checks so a
 * `\`-separated citation is recognised at all, but the `./` prefix is stripped
 * only afterwards: `./README.md` needs its slash to look like a path, and would
 * vanish if reduced to a bare filename first.
 * @param body - Markdown text.
 * @returns Sorted unique candidate repo-relative paths.
 */
function extractPaths(body) {
  const found = new Set();
  for (const match of body.matchAll(CODE_SPAN)) {
    if (body.startsWith('](', match.index + match[0].length)) continue;
    const stripped = stripLocator(match[1].trim());
    const shaped = normaliseSeparators(stripped);
    if (!PATH_SHAPE.test(shaped)) continue;
    if (!withinRepo(shaped)) continue;
    const token = canonicalisePath(shaped);
    if (IGNORED_PREFIXES.some(p => token.startsWith(p))) continue;
    if (OPTIONAL_PATHS.has(token)) continue;
    found.add(token);
  }
  return [...found].sort();
}

/**
 * Paths the diff removes, which a PR body may legitimately cite.
 *
 * Renames count: a PR that moves a file and describes the move cites the old
 * path, which no longer exists. `--diff-filter=DR` with `-z` gives both the
 * deletions and the source side of each rename, NUL-delimited so a path with
 * a space cannot split a record.
 * @param base - Git ref to diff against.
 * @returns Set of removed paths (empty when git is unavailable).
 */
function deletedInDiff(base) {
  let out;
  try {
    out = execFileSync(
      'git',
      ['diff', '--name-status', '--diff-filter=DR', '--find-renames', '-z', `${base}...HEAD`],
      { encoding: 'utf8' },
    );
  } catch {
    stderr.write(`  ! could not read diff against ${base}; removed paths will report as missing\n`);
    return new Set();
  }
  // Records are NUL-separated: `D<NUL>path` for a delete, and
  // `R100<NUL>old<NUL>new` for a rename. Only the old side interests us.
  const fields = out.split('\0').filter(Boolean);
  const removed = new Set();
  for (let i = 0; i < fields.length; i += 1) {
    const status = fields[i];
    if (status.startsWith('D')) {
      removed.add(fields[i + 1]);
      i += 1;
    } else if (status.startsWith('R')) {
      removed.add(fields[i + 1]);
      i += 2;
    }
  }
  return removed;
}

/**
 * Check one file, printing a line per unresolved path.
 * @param file - Markdown file to scan.
 * @param deleted - Paths the diff removes.
 * @returns Count of unresolved paths.
 */
function checkFile(file, deleted) {
  const body = readFileSync(file, 'utf8');
  const candidates = extractPaths(body);
  const missing = candidates.filter(p => !existsSync(p) && !deleted.has(p));
  stdout.write(`${file}: ${candidates.length} cited, ${missing.length} unresolved\n`);
  for (const p of missing) stdout.write(`  ✗ ${p}\n`);
  return missing.length;
}

const args = argv.slice(2);
const baseIdx = args.indexOf('--diff-base');
// Guard on `baseIdx !== -1`: without it the value index collapses to 0 when
// the flag is absent, silently discarding the first file argument.
const valueIdx = baseIdx === -1 ? -1 : baseIdx + 1;
const base = baseIdx === -1 ? null : args[valueIdx];
const files = args.filter((a, i) => !a.startsWith('--') && i !== valueIdx);

if (baseIdx !== -1 && (base === undefined || base.startsWith('--'))) {
  // Silently treating a valueless flag as "no base" would disable
  // removed-path handling and report a legitimate deletion as drift.
  stderr.write('--diff-base requires a ref, e.g. --diff-base origin/main\n');
  exit(2);
}

if (files.length === 0) {
  stderr.write('Usage: node scripts/check-doc-paths.mjs [--diff-base <ref>] <file.md> ...\n');
  exit(2);
}

const deleted = base ? deletedInDiff(base) : new Set();
let failures = 0;
for (const file of files) {
  try {
    failures += checkFile(file, deleted);
  } catch (err) {
    stderr.write(`Failed to read ${file}: ${err.message}\n`);
    exit(2);
  }
}

if (failures > 0) {
  stderr.write(`\ncheck-doc-paths: ${failures} cited path(s) do not exist.\n`);
  stderr.write('Update the citation to the current location, or restore the file.\n');
  exit(1);
}
stdout.write('check-doc-paths: all cited paths resolve ✓\n');
exit(0);
