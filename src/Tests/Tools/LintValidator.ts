/**
 * LintValidator — pure helpers powering the architecture gate.
 * The gate is invoked both by `npm run lint:architecture` (with directory
 * arguments — which the walker expands) and by the pre-commit hook (with
 * individual file paths from xargs). Both call paths must produce the
 * same results on the same resolved file set.
 *
 * Rule enforcement:
 *   Rule #15  — primitive return types in Pipeline/Phases
 *   Rule #10  — Playwright imports in Phase files
 *   [Async]   — unawaited execute/fetch/run/step calls
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Path fragment that marks a file as part of the Pipeline tree. */
const PIPELINE_DIR = 'Scrapers/Pipeline';
/** Path fragment that marks a file as a Phase. */
const PHASE_DIR = 'Phases';

/** Rule key enum — any future rule must be listed here. */
export type RuleKey = 'Rule #15' | 'Rule #10' | '[Async]';

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
      (v): v is RuleKey => v === 'Rule #15' || v === 'Rule #10' || v === '[Async]',
    );
    const normKey = normalisePath(key);
    out.set(normKey, new Set(rules));
  }
  return out;
}

/** Regex: primitive return type following a closing paren. */
const PRIMITIVE_RETURN_RE = /\)\s*:\s(?:boolean|string|number|void)(?=\s*[{=]|\s*\n)/g;
/** Regex: Playwright import in a Phase file. */
const PLAYWRIGHT_IMPORT_RE = /from ['"]playwright['"]/;
/** Regex: call positions at line start — execute/fetch/run/step family. */
const CALL_POS_RE = /^.*(?:execute|fetch|run|step)\w+\(/gm;
/** Regex: name of the called function. */
const CALL_NAME_RE = /(?:execute|fetch|run|step)\w+/;
/** Regex: hallmarks that make a call line safe (awaited, declaration, etc). */
const SAFE_CONTEXT_RE =
  /await\s|async\s|function\s|const\s|export\s|return\s|import\s|describe\(|it\(|=>\s|['"`]/;
/** Regex: strip every backtick-delimited template literal. */
const TEMPLATE_LITERAL_RE = /`[\s\S]*?`/g;

/**
 * Emit Rule #15 (primitive-return) issues for a file.
 * @param code - Source text.
 * @returns Rule #15 issues (may be empty).
 */
function ruleFifteenIssues(code: string): IIssue[] {
  const out: IIssue[] = [];
  const matches = code.match(PRIMITIVE_RETURN_RE) ?? [];
  for (const m of matches) {
    out.push({
      rule: 'Rule #15',
      message: `[Rule #15] Forbidden primitive return: ${m.trim()}`,
    });
  }
  PRIMITIVE_RETURN_RE.lastIndex = 0;
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
 * Analyse code text and produce raw issues (unfiltered by allowlist).
 * @param filePath - For scope detection (Pipeline/Phase).
 * @param code - Full source text.
 * @returns All issues emitted by the rule set.
 */
function issuesFromCodeRaw(filePath: string, code: string): IIssue[] {
  const issues: IIssue[] = [];
  const fwd = normalisePath(filePath);
  const isInPipeline = fwd.includes(PIPELINE_DIR) || fwd.includes(PHASE_DIR);
  if (isInPipeline) issues.push(...ruleFifteenIssues(code));
  if (fwd.includes(PHASE_DIR) && PLAYWRIGHT_IMPORT_RE.test(code)) {
    issues.push({ rule: 'Rule #10', message: '[Rule #10] Playwright leaked into Phase.' });
  }
  if (isInPipeline) issues.push(...asyncIssues(code));
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
