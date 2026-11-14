#!/usr/bin/env node
/**
 * Assert that our shell gates run on every OS a contributor may use.
 *
 * Why this script exists: the husky gates and the CI shell scripts are
 * the repo's quality floor, but they only enforce anything on a machine
 * where they actually execute. Four constructs had crept in and made
 * four gates abort on macOS — `declare -A` (bash 4+; macOS ships bash
 * 3.2 and has since 2007) in `docs-coverage.sh` and `docs-staleness.sh`,
 * `xargs -a` (a GNU extension absent from BSD xargs) in the pre-commit
 * architecture gate, and two hyphenated function names in the
 * pre-commit hook itself.
 *
 * That last one is the sharpest edge. husky runs a hook with
 * `sh -e "$hook"`, so the `#!/usr/bin/env bash` shebang at the top is
 * decoration — the file executes under POSIX sh, which on macOS is bash
 * in posix mode, and that rejects `some-name() {` outright. The hook
 * died mid-run after 19 gates had already passed.
 *
 * The failure mode is quiet and expensive: the gate does not report a
 * violation, it reports a *syntax error*, so a macOS contributor sees a
 * red hook that has nothing to do with their change and learns to reach
 * for `--no-verify`. A gate that only runs on ubuntu-latest is not a
 * gate — it is a CI-only afterthought that lets bad commits reach the
 * push.
 *
 * Scope, stated honestly: this is a lexical scan for a known-bad list,
 * not a shell parser. It cannot prove a script is portable; it only
 * proves these specific constructs are absent. It deliberately does NOT
 * flag bash-isms that macOS's bash-as-sh still accepts (arrays,
 * `PIPESTATUS`, `local`), which the hooks rely on throughout — those
 * would break only under dash, and rewriting them is a separate job.
 * Comment-only lines are skipped so a script may still *describe* the
 * construct it avoids — which is exactly what the fixed scripts do.
 *
 * Usage:
 *   node scripts/check-shell-portability.mjs
 *
 * Exit codes:
 *   0  no known-unportable construct found
 *   1  at least one found (details on stderr)
 */
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Directories scanned for shell code, relative to the repo root.
 * `.github/actions` holds composite-action scripts; only its `.sh`
 * files are scanned. The ESLint canary directory holds the bash canaries
 * that `lint:canaries` runs in the hook and in CI.
 */
const ROOTS = [
  '.husky',
  '.github/scripts',
  '.github/actions',
  'scripts',
  'src/Scrapers/Pipeline/EslintCanaries',
];

/** Paths skipped: husky's generated helpers are not ours to fix. */
const SKIP = new Set(['_', 'node_modules']);

/**
 * Known-unportable constructs. `why` is printed verbatim to the
 * contributor, so it names the portable replacement rather than just
 * stating that the construct is banned.
 */
const RULES = [
  {
    pattern: /(?:^|\s)(?:declare|local|typeset)\s+-A\b/,
    why: 'associative arrays are bash 4+; macOS ships bash 3.2. Source .github/scripts/ci/portable-map.sh and use map_put/map_get/map_get_all/map_has.',
  },
  {
    pattern: /^\s*[A-Za-z0-9_]*-[A-Za-z0-9_-]*\s*\(\)/,
    why: 'husky runs hooks via `sh -e "$hook"`, which ignores the shebang. POSIX sh — and bash-as-sh, which is what /bin/sh is on macOS — rejects a hyphen in a function name with "not a valid identifier" and aborts the whole hook. Use underscores.',
  },
  {
    pattern: /\bxargs\s+(?:-\w+\s+)*-a\b/,
    why: '`xargs -a FILE` is a GNU extension; BSD xargs aborts. Use `xargs CMD < FILE`.',
  },
  {
    pattern: /\b(?:mapfile|readarray)\b/,
    why: 'mapfile/readarray are bash 4+. Use `while IFS= read -r line; do ... done < file`.',
  },
  {
    pattern: /\$\{[A-Za-z_][A-Za-z0-9_]*(?:,,|\^\^)/,
    why: '${var,,} / ${var^^} case conversion is bash 4+. Use `tr "[:upper:]" "[:lower:]"`.',
  },
  {
    pattern: /\bgrep\s+(?:-\w+\s+)*-\w*P\b/,
    why: '`grep -P` needs PCRE, which BSD grep lacks. Use `grep -E`.',
  },
  {
    pattern: /\breadlink\s+(?:-\w+\s+)*-\w*f\b/,
    why: '`readlink -f` is GNU-only on older macOS. Use `cd "$(dirname "$x")" && pwd`.',
  },
  {
    pattern: /\bsed\s+(?:-\w+\s+)*-i\s+(?:-\w+\s+)*(?:["']?[^-\s"']|$)/,
    why: '`sed -i` without a backup suffix differs on BSD. Write to a temp file and mv.',
  },
  {
    pattern: /\bdate\s+(?:-\w+\s+)*-d\s/,
    why: '`date -d` is GNU-only; BSD date uses -v/-j. Compute the date in node instead.',
  },
];

/** True when the line carries no executable code (blank or a comment). */
function isComment(line) {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

/** True when the file is shell code we are responsible for. */
function isShellFile(path, name) {
  if (name.endsWith('.sh')) return true;
  if (!path.startsWith('.husky')) return false;
  return !name.includes('.');
}

/**
 * Every shell file under `dir`, recursively.
 *
 * <p>`lstat`, not `stat`: `stat` follows links, so a dangling link killed the
 * whole gate with `ENOENT` and a link back into the tree made the walk
 * re-enter itself forever. A link is never the file we are responsible for —
 * its target is walked on its own account if it lives under a root.
 */
function collect(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) collect(path, out);
    else if (isShellFile(path, name)) out.push(path);
  }
  return out;
}

/**
 * A multi-line program passed as a double-quoted `-e` / `-c` argument. The
 * shell expands that string before the interpreter sees it, so a backtick
 * or `$(` anywhere in it — even inside one of the program's own comments —
 * runs as a command. One such comment started an interactive bash that hung
 * `npm run lint` whenever stdin was a terminal.
 */
const INLINE_PROGRAM = {
  open: /\s-[ec]\s+"\s*$/,
  // The closing quote ends the line or is followed by shell syntax; a program
  // line such as `"use strict";` continues the program.
  close: /^"(?:$|[\s);>|&])/,
  expansion: /`|\$\(/,
  why: 'a double-quoted inline program is expanded by the shell, so a backtick or $( in it runs as a command. Pass the program as a quoted heredoc (`node - "$arg" <<\'JS\'`) and its inputs as arguments.',
};

/** Index of the line that closes an inline program opened at `start`. */
function closingLine(lines, start) {
  const rest = lines.slice(start + 1);
  const offset = rest.findIndex((line) => INLINE_PROGRAM.close.test(line.trimStart()));
  return offset === -1 ? lines.length : start + 1 + offset;
}

/** True when an inline program opened at `start` contains a shell expansion. */
function expandsInline(lines, start) {
  const body = lines.slice(start + 1, closingLine(lines, start));
  return body.some((line) => INLINE_PROGRAM.expansion.test(line));
}

/** Inline-program violations in one file's lines. */
function scanInline(path, lines) {
  const opened = lines.flatMap((line, i) =>
    !isComment(line) && INLINE_PROGRAM.open.test(line) ? [i] : [],
  );
  return opened
    .filter((i) => expandsInline(lines, i))
    .map((i) => ({ path, line: i + 1, rule: INLINE_PROGRAM, text: lines[i].trim() }));
}

/** Every rule violation in one file, as printable records. */
function scan(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) hits.push({ path, line: i + 1, rule, text: line.trim() });
    }
  });
  return [...hits, ...scanInline(path, lines)];
}

/** Prints the failure report for every violation found. */
function report(hits) {
  console.error('[shell-portability] FAIL — unportable shell constructs:\n');
  for (const hit of hits) {
    console.error(`  ${hit.path}:${hit.line}`);
    console.error(`      ${hit.text}`);
    console.error(`      -> ${hit.rule.why}\n`);
  }
  console.error('These gates must run on macOS (bash 3.2 + BSD tools),');
  console.error('Linux (bash 5 + GNU) and Git-Bash on Windows alike.');
}

const files = ROOTS.filter((r) => {
  try {
    return statSync(r).isDirectory();
  } catch {
    return false;
  }
}).flatMap((root) => collect(root, []));

const violations = files.flatMap(scan);

if (violations.length > 0) {
  report(violations);
  process.exit(1);
}

console.log(`[shell-portability] ${files.length} shell file(s) scanned. PASS.`);
