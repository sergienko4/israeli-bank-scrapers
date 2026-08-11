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
 * Artefacts created at run time, which a doc may legitimately cite while
 * they are absent. The PR-body handoff file is the motivating case: the
 * pre-push hook *searches* these locations, so documenting them is
 * correct even on a checkout where no PR is in flight. Without this the
 * gate would pass on a machine that happens to have one lying around and
 * fail in CI — a flake, which is worse than no gate at all.
 */
const OPTIONAL_PATHS = new Set(['.github/PR_BODY.md']);

/**
 * Strip a trailing locator (`:42`, `:analyze`, `#L17`) so `file.ts:12` and
 * `file.ts#L17` both resolve against `file.ts`. The suffix itself is not
 * verified. Both forms appear in agent docs, and dropping the suffix is
 * cheaper than losing the coverage.
 * @param token - Raw inline-code token.
 * @returns Token without a trailing locator.
 */
function stripLocator(token) {
  const cut = [token.indexOf(':'), token.indexOf('#')].filter((i) => i !== -1);
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
 * @param body - Markdown text.
 * @returns Sorted unique candidate repo-relative paths.
 */
function extractPaths(body) {
  const found = new Set();
  for (const match of body.matchAll(CODE_SPAN)) {
    if (body.startsWith('](', match.index + match[0].length)) continue;
    const token = stripLocator(match[1].trim());
    if (!PATH_SHAPE.test(token)) continue;
    if (!withinRepo(token)) continue;
    if (IGNORED_PREFIXES.some((p) => token.startsWith(p))) continue;
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
  const missing = candidates.filter((p) => !existsSync(p) && !deleted.has(p));
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
