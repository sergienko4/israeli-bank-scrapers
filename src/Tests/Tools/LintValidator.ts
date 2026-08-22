/**
 * LintValidator — pure helpers powering the architecture gate.
 * The gate is invoked both by `npm run lint:architecture` (with directory
 * arguments — which the walker expands) and by the pre-commit hook (with
 * individual file paths from xargs). Both call paths must produce the
 * same results on the same resolved file set.
 *
 * Rule enforcement:
 *   Rule #15  — primitive return types in Pipeline/Phases
 *   Rule #16  — selector-based interaction inside the Pipeline tree
 *   Rule #17  — module specifiers retired by the shim sweep
 *   Rule #10  — Playwright imports in Phase files
 *   [Async]   — unawaited execute/fetch/run/step calls
 *   PII-Log   — raw PII identifier or full payload bucket in LOG.*
 *               (T09 template-literal + T16 object-key bypass guards)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Path fragment that marks a file as part of the Pipeline tree. */
const PIPELINE_DIR = 'Scrapers/Pipeline';
/** Path fragment that marks a file as a Phase. */
const PHASE_DIR = 'Phases';

/** The four interaction helpers whose contract is "give me a CSS selector". */
const SELECTOR_INTERACTION_RE =
  /\b(?:clickButton|clickLink|waitUntilElementFound|waitUntilElementDisappear)\s*\(/;
/** Declaration site of those helpers — matched so it can be skipped. */
const SELECTOR_INTERACTION_DECL_RE =
  /\bfunction\s+(?:clickButton|clickLink|waitUntilElementFound|waitUntilElementDisappear)\s*\(/;

/**
 * Decide whether a line CALLS a selector-based interaction helper.
 *
 * Requiring an opening paren is what separates a call from a mention, and it
 * is why no import/export guard is needed: `import { clickButton } from …`
 * and `export { clickButton } from …` spell the name followed by `,` or `}`,
 * never `(`. An explicit boundary check was written here first and removed
 * once mutation testing showed it could never fire — a guard that cannot fail
 * reads as load-bearing while protecting nothing. The import and export rows
 * in RULE_16_CASES stay, so that broadening the pattern above re-tests them.
 *
 * Neither regex carries the `g` flag: `.test()` on a global regex advances
 * `lastIndex` between calls, so a per-line predicate would skip every other
 * match. Rule #15 works around that with explicit resets; not opting in is
 * simpler and removes the failure mode entirely.
 *
 * @param line - One source line.
 * @returns True when the line is a call site rather than a declaration.
 */
function isSelectorInteractionCall(line: string): boolean {
  if (!SELECTOR_INTERACTION_RE.test(line)) return false;
  return !SELECTOR_INTERACTION_DECL_RE.test(line);
}

/** Rule key enum — any future rule must be listed here. */
export type RuleKey =
  | 'Rule #15'
  | 'Rule #10'
  | 'Rule #16'
  | 'Rule #17'
  | '[Async]'
  | 'PII-Log'
  | 'S6564-Canary'
  | 'S3735-Canary'
  | 'S1607-Canary';

/** One violation emitted by the analyser. */
export interface IIssue {
  readonly rule: RuleKey;
  readonly message: string;
}

/** Whether a path should be skipped before analysis. */
type IsExcludedFlag = boolean;

/**
 * Decide whether a given file path is excluded from analysis.
 * Excludes EslintCanary fixtures and build outputs.
 * @param filePath - Repo-relative or absolute path.
 * @returns True when the file must be skipped.
 */
export function isExcluded(filePath: string): IsExcludedFlag {
  const p = filePath.split(path.sep).join('/');
  if (p.includes('/EslintCanaries/')) return true;
  if (p.endsWith('.canary.ts')) return true;
  if (p.includes('/node_modules/') || p.startsWith('node_modules/')) return true;
  if (p.includes('/lib/') || p.startsWith('lib/')) return true;
  if (p.includes('/dist/') || p.startsWith('dist/')) return true;
  if (!p.endsWith('.ts')) return true;
  return false;
}

/** Recursively walked file-list accumulator. */
type FileAccumulator = string[];
/** Signal the walker returns on success or directory-read failure. */
type WalkResult = true;

/**
 * Safely read a directory's entries. Returns an empty list on failure so
 * the walker can continue across permission / race errors.
 * @param dir - Directory path.
 * @returns Dirent list (empty on failure).
 */
function readDirEntries(dir: string): readonly fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Walk one directory node, appending `.ts` files to the accumulator.
 * @param dir - Directory to scan.
 * @param out - Accumulator (mutated).
 * @returns Sentinel true when recursion step completed.
 */
function walkDir(dir: string, out: FileAccumulator): WalkResult {
  const entries = readDirEntries(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, out);
      continue;
    }
    if (entry.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return true;
}

/**
 * Expand a list of paths (files, directories, or non-existent strings)
 * to a flat list of `.ts` files. Directories are walked recursively.
 * @param paths - Mixed list of paths.
 * @returns Flat list of TypeScript file paths.
 */
export function expandToFiles(paths: readonly string[]): readonly string[] {
  const out: FileAccumulator = [];
  for (const p of paths) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walkDir(p, out);
    else if (stat.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Allowlist map: path → set of rule keys suppressed for that path. */
type AllowlistMap = Map<string, ReadonlySet<RuleKey>>;

/**
 * Normalise a candidate path to forward-slash form.
 * @param p - Path using any OS separator.
 * @returns Path with forward slashes only.
 */
function normalisePath(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Read the allowlist JSON file.
 * Shape: `{ "relative/path.ts": ["Rule #15", "[Async]"] }`.
 * Missing file or unparseable JSON yields an empty map.
 * @param allowlistPath - Optional override; defaults to the standard location.
 * @returns Allowlist map (empty on failure).
 */
export function loadAllowlist(
  allowlistPath = 'src/Tests/Tools/architecture-allowlist.json',
): AllowlistMap {
  const empty: AllowlistMap = new Map();
  let raw: string;
  try {
    raw = fs.readFileSync(allowlistPath, 'utf8');
  } catch {
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write(`[lint-and-validate] allowlist parse error: ${allowlistPath}\n`);
    return empty;
  }
  if (typeof parsed !== 'object' || parsed === null) return empty;
  const record = parsed as Record<string, unknown>;
  const out: AllowlistMap = new Map();
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    const rules = value.filter(
      (v): v is RuleKey =>
        v === 'Rule #15' ||
        v === 'Rule #10' ||
        v === 'Rule #16' ||
        v === 'Rule #17' ||
        v === '[Async]' ||
        v === 'PII-Log' ||
        v === 'S6564-Canary' ||
        v === 'S3735-Canary' ||
        v === 'S1607-Canary',
    );
    const normKey = normalisePath(key);
    out.set(normKey, new Set(rules));
  }
  return out;
}

/**
 * Regex: primitive return type on a function-body opener.
 * Matches `): primitive {` only — function/method declarations with a
 * block body. Does NOT match `): primitive =>` (inline arrow
 * callbacks): callbacks never cross a module boundary, so Rule #15
 * (nominal types at module exports) is satisfied without branding
 * them. Combined with `isExportedDeclaration`, this restricts the
 * gate to exported function-decl boundaries — internal helpers are
 * also exempt.
 */
const PRIMITIVE_RETURN_RE = /\)\s*:\s(?:boolean|string|number|void)(?=\s*\{)/g;
/**
 * Regex: bare-primitive type alias declaration (S6564 canary).
 * Matches `type X = string;` / `= number;` / `= boolean;` / `= unknown;`.
 * Excluded by SonarJS S6564 because the RHS is a TS keyword type;
 * defence-in-depth here so a bypass via `eslint --no-verify` still
 * trips the architecture gate. Per-file overrides for the
 * architecture-rule conflict cases live in
 * `architecture-allowlist.json` (rule key `S6564-Canary`).
 */
const S6564_CANARY_RE = /^type\s+[A-Z]\w*\s*=\s*(?:boolean|string|number|void|unknown);/gm;
/**
 * Regex: `void <expression>;` operator at statement start (S3735 canary).
 * Catches the discard-promise antipattern. Defence-in-depth.
 */
const S3735_CANARY_RE = /^\s*void\s+\w/gm;
/**
 * Regex: `it.skip(`/`describe.skip(` (S1607 canary).
 * Matches the call site; the issue-ref rationale check runs on the
 * surrounding text and accepts an issue marker like `#nnn` in a
 * trailing comment.
 */
const SKIPPED_TEST_RE = /(?:^|\s)(?:it|describe|test)\.skip\(/gm;
/** Regex: a `#nnn` issue reference near a skipped test, used as rationale. */
const SKIP_RATIONALE_RE = /\/\/[^\n]*#\d+/;
/**
 * Regex: a Playwright import in a Phase file, capturing its binding clause.
 *
 * Matches both the `playwright` and `playwright-core` specifiers — this fork
 * imports the latter, so a rule anchored to the bare name guards nothing.
 * `import type` is deliberately excluded: it is erased at compile time and
 * creates no runtime coupling, so a Phase naming `Page` in a signature is
 * legitimate. Only a value import can actually drag the driver into a Phase.
 *
 * The capture group is required because the `import type` prefix is not the
 * only type-only form: `import { type Page } from 'playwright-core'` is also
 * fully erased, and is the dominant style in this repo. Matching the statement
 * alone would flag it, so {@link hasRuntimePlaywrightImport} inspects the
 * captured bindings rather than trusting the statement shape.
 */
const PLAYWRIGHT_IMPORT_RE = /^\s*import\b(?!\s+type\b)([^;]*?)['"]playwright(?:-core)?['"]/gm;
/** Regex: call positions at line start — execute/fetch/run/step family. */
const CALL_POS_RE = /^.*(?:execute|fetch|run|step)\w+\(/gm;
/** Regex: name of the called function. */
const CALL_NAME_RE = /(?:execute|fetch|run|step)\w+/;
/** Regex: hallmarks that make a call line safe (awaited, declaration, etc). */
const SAFE_CONTEXT_RE =
  /await\s|async\s|function\s|const\s|export\s|return\s|import\s|describe\(|it\(|=>\s|['"`]/;
/** Regex: strip every backtick-delimited template literal. */
const TEMPLATE_LITERAL_RE = /`[\s\S]*?`/g;
/** PII identifier names banned inside LOG.* template literals (T09). */
const PII_IDENTIFIER_NAMES: readonly string[] = [
  'accountId',
  'cardNumber',
  'phoneNumber',
  'israeliId',
  'firstName',
  'lastName',
  'fullName',
  'customerName',
  'otpCode',
  'password',
  'pinCode',
  'nationalId',
  'MisparZihuy',
  'otpLongTermToken',
  'otpToken',
  'idToken',
  'userName',
  'UserName',
  'email',
  'cookie',
  'setCookie',
];
/** Object keys that imply a full payload bucket (T16). */
const PII_PAYLOAD_KEYS: readonly string[] = [
  'result',
  'accounts',
  'transactions',
  'txns',
  'scrapeOutput',
  'rawTxn',
  'rawAccount',
  'rawAccounts',
  'rawTxns',
];
/** Identifier names that, when passed as RHS, indicate a raw payload (T16b). */
const PII_PAYLOAD_NAMES: readonly string[] = [
  'scrapeOutput',
  'rawTxn',
  'rawAccount',
  'rawAccounts',
  'rawTxns',
  'fullAccounts',
  'allTxns',
  'accountsArr',
  'txnsArr',
];
/** LOG levels matched by both PII regexes. */
const PII_LOG_LEVELS = '(?:trace|debug|info|warn|error|fatal)';
/** Regex: PII identifier interpolated into LOG.* template literal (T09). */
const PII_TEMPLATE_RE = new RegExp(
  String.raw`LOG\.${PII_LOG_LEVELS}\s*\(\s*\x60[\s\S]*?\$\{(?:${PII_IDENTIFIER_NAMES.join('|')})`,
  'g',
);
/** Regex: forbidden payload bucket passed to LOG.* (T16). The lookahead
 * `(?=\s*[,}])` rejects scalar accessors like `allTxns.length` while still
 * matching whole-payload identifiers like `scrapeOutput` or `rawTxns`. */
const PII_PAYLOAD_RE = new RegExp(
  String.raw`LOG\.${PII_LOG_LEVELS}\s*\(\s*\{[^}]*?\b(?:${PII_PAYLOAD_KEYS.join('|')})\s*:\s*(?:\[|\.\.\.|(?:${PII_PAYLOAD_NAMES.join('|')})(?=\s*[,}]))`,
  'g',
);

/**
 * Emit S6564-Canary issues for a file. Catches bare-primitive aliases
 * even when ESLint is bypassed.
 * @param code - Source text.
 * @returns S6564-Canary issues (may be empty).
 */
function s6564CanaryIssues(code: string): IIssue[] {
  const out: IIssue[] = [];
  const lines = code.split('\n');
  for (const [idx, line] of lines.entries()) {
    S6564_CANARY_RE.lastIndex = 0;
    if (!S6564_CANARY_RE.test(line)) continue;
    out.push({
      rule: 'S6564-Canary',
      message: `[S6564-Canary] Bare-primitive type alias at line ${String(idx + 1)}: ${line.trim()}`,
    });
  }
  S6564_CANARY_RE.lastIndex = 0;
  return out;
}

/**
 * Emit S3735-Canary issues for a file. Catches the `void <expr>;`
 * discard-promise antipattern.
 * @param code - Source text.
 * @returns S3735-Canary issues (may be empty).
 */
function s3735CanaryIssues(code: string): IIssue[] {
  const out: IIssue[] = [];
  const matches = code.match(S3735_CANARY_RE) ?? [];
  for (const m of matches) {
    out.push({
      rule: 'S3735-Canary',
      message: `[S3735-Canary] void operator: ${m.trim()}`,
    });
  }
  S3735_CANARY_RE.lastIndex = 0;
  return out;
}

/**
 * Emit S1607-Canary issues for a file. Each `it.skip` / `describe.skip`
 * must have a `#nnn` issue reference within 3 lines preceding the call
 * site so the suppression is auditable.
 * @param code - Source text.
 * @returns S1607-Canary issues (may be empty).
 */
function s1607CanaryIssues(code: string): IIssue[] {
  const out: IIssue[] = [];
  const lines = code.split('\n');
  for (const [idx, line] of lines.entries()) {
    SKIPPED_TEST_RE.lastIndex = 0;
    if (!SKIPPED_TEST_RE.test(line)) continue;
    const start = Math.max(0, idx - 3);
    const window = lines.slice(start, idx + 1).join('\n');
    if (SKIP_RATIONALE_RE.test(window)) continue;
    out.push({
      rule: 'S1607-Canary',
      message: `[S1607-Canary] Skipped test without #issue rationale at line ${String(idx + 1)}`,
    });
  }
  SKIPPED_TEST_RE.lastIndex = 0;
  return out;
}

/** Regex: function or const declaration (any visibility). */
const FUNCTION_OR_CONST_DECL_RE = /\b(?:function|const)\s+\w+/;
/** Regex: declaration line decorated with `export`. */
const EXPORT_KEYWORD_RE = /\bexport\b/;
/** Regex: line that carries ONLY the `export` keyword (multi-line decoration). */
const EXPORT_LINE_ONLY_RE = /^\s*export\s*$/;

/**
 * Walk backwards from the match line to the closest function-or-const
 * declaration, then check whether the declaration itself carries
 * `export` (same line) or whether the line immediately above is an
 * `export` line on its own. Internal helpers (no `export`) are
 * permitted to return primitives — Rule #15 enforces nominal types
 * only at module boundaries (= `export`ed declarations).
 *
 * @param matchIdx - Index of the line where PRIMITIVE_RETURN_RE matched.
 * @param lines - File source split by newline.
 * @returns True when the enclosing declaration is exported.
 */
function isExportedDeclaration(matchIdx: number, lines: readonly string[]): boolean {
  for (let i = matchIdx; i >= 0; i--) {
    const line = lines[i];
    if (!FUNCTION_OR_CONST_DECL_RE.test(line)) continue;
    if (EXPORT_KEYWORD_RE.test(line)) return true;
    if (i > 0 && EXPORT_LINE_ONLY_RE.test(lines[i - 1])) return true;
    return false;
  }
  return false;
}

/**
 * Emit Rule #15 (primitive-return) issues for a file. Scope: only
 * EXPORTED functions/consts. Internal helpers may return primitives —
 * the architectural intent is nominal typing across module boundaries,
 * not inside a single file. Class methods (declared without `function`/
 * `const` keywords on the same line walk) fall through to the default
 * "not exported" branch and are NOT flagged here; the existing
 * `no-restricted-syntax` ESLint rule already handles class-method
 * primitive returns via AST.
 *
 * @param code - Source text.
 * @returns Rule #15 issues (may be empty).
 */
function ruleFifteenIssues(code: string): IIssue[] {
  const out: IIssue[] = [];
  const lines = code.split('\n');
  for (const [idx, line] of lines.entries()) {
    PRIMITIVE_RETURN_RE.lastIndex = 0;
    if (!PRIMITIVE_RETURN_RE.test(line)) continue;
    PRIMITIVE_RETURN_RE.lastIndex = 0;
    if (!isExportedDeclaration(idx, lines)) continue;
    out.push({
      rule: 'Rule #15',
      message: `[Rule #15] Forbidden primitive return at line ${String(idx + 1)}: ${line.trim()}`,
    });
  }
  PRIMITIVE_RETURN_RE.lastIndex = 0;
  return out;
}

/**
 * Emit Rule #16 (zero-CSS interaction) issues for a file.
 *
 * The zero-CSS rule is absolute for Pipeline interaction code: elements are
 * located by what a user can read (`getByText`/`getByRole`/`getByPlaceholder`),
 * never by a CSS selector. The Pipeline tree honours that today with zero
 * violations, but until now nothing enforced it, so a single `clickButton(ctx,
 * '#submit')` could reintroduce brittle selector coupling unnoticed. This is a
 * regression guard, not a cleanup.
 *
 * Scope is deliberately narrow — the four selector-taking interaction helpers,
 * and only their CALL sites:
 *
 *  - Declarations are skipped. `ElementWaitAction.ts` and
 *    `ElementsInteractions.ts` define these helpers inside the Pipeline tree;
 *    flagging a definition would make the rule unsatisfiable.
 *  - Import/export lines are skipped by construction: the pattern requires an
 *    opening paren, and `import { clickButton } from …` never has one. The
 *    helpers stay exported because `src/Common/ElementsInteractions.ts`
 *    re-exports them to legacy callers. Ignoring legacy is the ruling;
 *    breaking it is not.
 *  - Raw DOM APIs (`querySelector`, `waitForSelector`, `pageEvalAll`) are NOT
 *    covered. Inside Pipeline they appear only in parsing/extraction code and
 *    in these helpers' own implementations — the documented exception. Banning
 *    them would flag eleven compliant files and force an allowlist.
 *
 * @param code - Source text.
 * @returns Rule #16 issues (may be empty).
 */
function ruleSixteenIssues(code: string): IIssue[] {
  const out: IIssue[] = [];
  const lines = code.split('\n');
  for (const [idx, line] of lines.entries()) {
    if (!isSelectorInteractionCall(line)) continue;
    const where = String(idx + 1);
    out.push({
      rule: 'Rule #16',
      message: `[Rule #16] Selector-based interaction at line ${where}: ${line.trim()}`,
    });
  }
  return out;
}

/**
 * Module specifiers retired during the Phase 3 shim sweep, mapped to what
 * replaced them. Each was a deprecated re-export whose importers have all
 * moved; the files are deleted.
 *
 * Deleting a shim is not self-enforcing. A revert, a merge from a long-lived
 * branch, or an editor auto-import working from a stale index can recreate
 * the file and quietly restore the indirection. Type-check only catches the
 * window where the file is absent — recreate it and the tree compiles again.
 * This map closes that window and, more usefully, answers "what do I import
 * instead?" at the point of failure.
 */
const RETIRED_SPECIFIERS: ReadonlyMap<string, string> = new Map([
  ['IApiDirectCallConfig.js', 'Mediator/ApiDirectCall/ConfigContracts/index.js'],
  ['Mediator/Network/Fetch.js', 'Mediator/Network/Fetch/index.js'],
  ['Mediator/Network/AuthDiscovery.js', 'Mediator/Network/Auth/AuthDiscovery.js'],
  ['Mediator/Network/AuthFailureWatcher.js', 'Mediator/Network/Auth/AuthFailureWatcher.js'],
]);

/**
 * Emit Rule #17 (retired module specifier) issues for a file.
 *
 * Matches the specifier as a substring so every spelling is caught. The
 * ApiDirectCall shim alone was reached four ways — `./`, `../`, and two
 * different `../../../` depths — and counting only one of them is what made
 * the original migration estimate too low by a factor of three.
 *
 * Match keys are trimmed to the shortest unambiguous fragment, not left as
 * full paths. `IApiDirectCallConfig.js` is a unique filename, so a bare match
 * also catches the same-directory `./IApiDirectCallConfig.js` spelling that
 * three files in the cluster used. The Network entries keep their
 * `Mediator/Network/` prefix on purpose: a bare `Fetch.js` would also flag
 * `src/Common/Fetch.js`, a live legacy shim that must keep working.
 *
 * Runs repo-wide rather than Pipeline-only: most of the importers that had to
 * move were tests, which live outside the Pipeline tree.
 *
 * @param code - Source text.
 * @returns Rule #17 issues (may be empty).
 */
function ruleSeventeenIssues(code: string): IIssue[] {
  const out: IIssue[] = [];
  for (const [idx, line] of code.split('\n').entries()) {
    for (const [retired, replacement] of RETIRED_SPECIFIERS) {
      if (!line.includes(retired)) continue;
      const where = String(idx + 1);
      out.push({
        rule: 'Rule #17',
        message: `[Rule #17] Retired specifier at line ${where}: ${retired} — use ${replacement}`,
      });
    }
  }
  return out;
}

/**
 * Emit PII-Log issues for a file. Catches T09 (PII identifier in LOG.*
 * template literal) and T16 (forbidden payload bucket passed to LOG.*).
 * Runs on ALL files (not Pipeline-scoped) — PII can leak from Common/,
 * Scrapers/Base/, Scrapers/<Bank>/ too, and Layer 2 is the only gate
 * that covers those paths.
 * @param code - Source text.
 * @returns PII-Log issues (may be empty).
 */
function piiLogIssues(code: string): IIssue[] {
  const out: IIssue[] = [];
  const tplMatches = code.match(PII_TEMPLATE_RE) ?? [];
  for (const m of tplMatches) {
    out.push({ rule: 'PII-Log', message: `[PII-Log] T09 PII in LOG template: ${m.trim()}` });
  }
  PII_TEMPLATE_RE.lastIndex = 0;
  const payloadMatches = code.match(PII_PAYLOAD_RE) ?? [];
  for (const m of payloadMatches) {
    out.push({ rule: 'PII-Log', message: `[PII-Log] T16 payload bucket in LOG: ${m.trim()}` });
  }
  PII_PAYLOAD_RE.lastIndex = 0;
  return out;
}

/**
 * Emit [Async] issues for a file.
 * @param code - Source text.
 * @returns [Async] issues (may be empty).
 */
function asyncIssues(code: string): IIssue[] {
  const out: IIssue[] = [];
  const stripped = code.replaceAll(TEMPLATE_LITERAL_RE, '""');
  let match = CALL_POS_RE.exec(stripped);
  while (match) {
    const line = match[0];
    if (!SAFE_CONTEXT_RE.test(line)) {
      const nameMatch = CALL_NAME_RE.exec(line);
      if (nameMatch) {
        out.push({ rule: '[Async]', message: `[Async] Unawaited: ${nameMatch[0]}` });
      }
    }
    match = CALL_POS_RE.exec(stripped);
  }
  CALL_POS_RE.lastIndex = 0;
  return out;
}

/**
 * Whether one entry of a brace binding list survives to runtime.
 * @param binding - A single comma-separated entry from an import clause.
 * @returns True when the entry is a value rather than an erased type.
 */
function isRuntimeBinding(binding: string): boolean {
  const trimmed = binding.trim();
  return trimmed !== '' && !/^type\s/.test(trimmed);
}

/**
 * Whether an import clause binds at least one runtime value.
 *
 * <p>A clause with no brace list is a default, namespace or side-effect
 * import, all of which are runtime. A braced clause is runtime only if some
 * binding is not `type`-prefixed; anything before the brace (a default
 * binding) is itself runtime.
 * @param clause - The text captured between `import` and the specifier.
 * @returns True when a value crosses the module boundary.
 */
function hasRuntimeBinding(clause: string): boolean {
  const open = clause.indexOf('{');
  if (open < 0) return true;
  if (clause.slice(0, open).replace(/[\s,]/g, '') !== '') return true;
  const close = clause.indexOf('}');
  const inner = clause.slice(open + 1, close);
  return inner.split(',').some(isRuntimeBinding);
}

/**
 * Whether a file imports Playwright as a runtime value.
 *
 * <p>Every Playwright import is inspected, not just the first: a Phase may
 * legitimately type-import `Page` and still illegitimately value-import
 * `chromium` further down.
 * @param code - Full source text.
 * @returns True when at least one Playwright value import exists.
 */
function hasRuntimePlaywrightImport(code: string): boolean {
  const matches = [...code.matchAll(PLAYWRIGHT_IMPORT_RE)];
  return matches.some((match): boolean => hasRuntimeBinding(match[1]));
}

/**
 * Files that necessarily spell the retired specifiers: the rule's own lookup
 * table, and the tests that prove it fires. A linter does not lint its own
 * fixtures — without this the rule flags thirteen strings it is made of and
 * can never be green.
 *
 * Path-based rather than syntactic on purpose. The test fixtures embed whole
 * `import … from '…'` statements inside string literals, so no amount of
 * "does this line look like an import" cleverness separates them from the
 * real thing.
 */
const RULE_17_OWN_MACHINERY: readonly string[] = [
  'Tests/Tools/LintValidator.ts',
  'Tests/Unit/Tools/LintAndValidate.test.ts',
];

/**
 * True when the file IS the retired-specifier machinery.
 * @param fwd - Normalised (forward-slash) file path.
 * @returns Whether Rule #17 must skip this file.
 */
function isRuleSeventeenMachinery(fwd: string): boolean {
  return RULE_17_OWN_MACHINERY.some((p): boolean => fwd.includes(p));
}

/**
 * Pipeline-scoped structural rules, grouped to keep the dispatcher under the
 * ten-statement helper cap.
 * @param code - Full source text.
 * @returns Rule #15 and Rule #16 issues.
 */
function pipelineStructureIssues(code: string): IIssue[] {
  return [...ruleFifteenIssues(code), ...ruleSixteenIssues(code)];
}

/**
 * Analyse code text and produce raw issues (unfiltered by allowlist).
 * @param filePath - For scope detection (Pipeline/Phase).
 * @param code - Full source text.
 * @returns All issues emitted by the rule set.
 */
function issuesFromCodeRaw(filePath: string, code: string): IIssue[] {
  const issues: IIssue[] = [];
  const fwd = normalisePath(filePath);
  const isInPipeline = fwd.includes(PIPELINE_DIR) || fwd.includes(PHASE_DIR);
  if (isInPipeline) issues.push(...pipelineStructureIssues(code));
  if (!isRuleSeventeenMachinery(fwd)) issues.push(...ruleSeventeenIssues(code));
  if (fwd.includes(PHASE_DIR) && hasRuntimePlaywrightImport(code)) {
    issues.push({ rule: 'Rule #10', message: '[Rule #10] Playwright leaked into Phase.' });
  }
  if (isInPipeline) issues.push(...asyncIssues(code));
  issues.push(...piiLogIssues(code));
  // Defence-in-depth canaries: re-affirm the SonarJS rules via regex
  // so a `--no-verify` ESLint bypass still trips the architecture gate.
  issues.push(...s6564CanaryIssues(code), ...s3735CanaryIssues(code), ...s1607CanaryIssues(code));
  return issues;
}

/**
 * Analyse a file given its path + allowlist.
 * @param filePath - Path to read.
 * @param allowlist - Pre-loaded allowlist map.
 * @returns Filtered issue list.
 */
export function analyzeFile(filePath: string, allowlist: AllowlistMap): IIssue[] {
  let code: string;
  try {
    code = fs.readFileSync(filePath, 'utf8');
  } catch {
    process.stderr.write(`[lint-and-validate] read error: ${filePath}\n`);
    return [];
  }
  return issuesFromCode(filePath, code, allowlist);
}

/**
 * Pure-input variant of analyzeFile — takes code directly.
 * Exported for unit tests that synthesise source strings.
 * @param filePath - Logical path for scope detection.
 * @param code - Source text.
 * @param allowlist - Allowlist map.
 * @returns Filtered issue list.
 */
export function issuesFromCode(filePath: string, code: string, allowlist: AllowlistMap): IIssue[] {
  const raw = issuesFromCodeRaw(filePath, code);
  const fwdPath = normalisePath(filePath);
  const allowed = allowlist.get(fwdPath);
  if (allowed === undefined || allowed.size === 0) return raw;
  return raw.filter((issue): boolean => !allowed.has(issue.rule));
}
