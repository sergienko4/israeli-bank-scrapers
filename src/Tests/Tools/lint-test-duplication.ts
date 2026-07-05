/**
 * TEST-DUPLICATION CANARY — fails when a `*.test.ts` function body is
 * byte-identical (comment/whitespace-normalized) to a production
 * (shipped `src/**`) function body.
 *
 * Enforces the guideline "Tests must NOT duplicate production logic —
 * import and reuse shared helpers from production code." A verbatim copy
 * silently drifts when the production helper changes, masking the very
 * regression the test should catch (CodeRabbit flagged exactly this on
 * PR #405: a test-local `todayParts` re-implemented `todayDatePart`).
 *
 * Scope:
 *   • test side       = files ending `.test.ts`.
 *   • production side  = every other `src/**` `.ts` that {@link isProdFile}
 *     accepts (not under `src/Tests/`, not a `.d.ts`) — shipped library
 *     logic.
 *   • test infra under `src/Tests/` that is not a `.test.ts` (helpers,
 *     factories, fixtures, Tools) is ignored on both sides: sharing a
 *     helper body across tests is allowed and is not "production logic".
 *
 * Only bodies with >= MIN_BODY_CHARS normalized characters are compared,
 * so trivial one-liners (`return x;`) never trip the gate. Legitimate
 * matches go in ALLOWLIST with a justifying comment.
 *
 * Invoked via `npm run lint:test-duplication`; wired into the pre-commit
 * gate ladder so a duplicated test body cannot reach `origin`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import ts from 'typescript';

import { isProdFile } from './ImportGraphScan.js';

const REPO_ROOT = process.cwd();
const SRC_ROOT = path.join(REPO_ROOT, 'src');

/**
 * Minimum normalized body length compared. Trivial pass-through stubs
 * (e.g. `succeed(input); return Promise.resolve(result)`) normalize to
 * ~55 chars and are not "logic"; the real multi-statement duplication
 * this gate targets is >= ~100 chars. 70 is the floor between the two.
 */
const MIN_BODY_CHARS = 70;

/**
 * Test bodies (`relativePath:functionName`, forward-slash) allowed to
 * coincide with a production body. Each entry needs a comment justifying
 * why importing the production helper is not the right fix.
 */
const ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // M2 (CI quality hardening) inverted the Network<-AccountResolve dependency:
  // Network owns `waitForFirstId`; ACCOUNT-RESOLVE owns the shape predicate.
  // This Network-primitive test mirrors the production-shape predicate to
  // exercise `waitForFirstId` WITHOUT importing AccountResolve internals —
  // exporting the internal `findFirstIdInPool` to share it would re-introduce
  // the coupling M2 removed. Deliberate, documented copy.
  'src/Tests/Unit/Pipeline/Mediator/Network/WaitForFirstId.test.ts:findFirstIdInPool',
]);

/** One function body, located + normalized for comparison. */
interface IBody {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly norm: string;
}

/** A test body that matches a production body. */
interface IViolation {
  readonly test: IBody;
  readonly prod: IBody;
}

/** Sentinel returned by side-effecting helpers (no-void rule). */
type Done = true;

/**
 * Recursively collect every `.ts` file under `dir` (skips `.d.ts`). Walks
 * from `src/`, which contains no `node_modules`, so no prune is needed.
 * @param dir - Directory to walk.
 * @param out - Accumulator (mutated).
 * @returns Sentinel true once recursion completes.
 */
function walkAllTs(dir: string, out: string[]): Done {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAllTs(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return true;
}

/**
 * Whether a node is a function-like declaration that can carry a block body.
 * @param node - Any AST node.
 * @returns True for function/arrow/method declarations.
 */
function isFnLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/**
 * The `{ ... }` block body of a function-like node, or false.
 * @param node - Any AST node.
 * @returns The block body, or false when absent / expression-bodied.
 */
function fnBlock(node: ts.Node): ts.Block | false {
  if (!isFnLike(node)) return false;
  const body = (node as ts.FunctionLikeDeclaration).body;
  if (body !== undefined && ts.isBlock(body)) return body;
  return false;
}

/**
 * Strip comments + all whitespace so formatting/comment differences do
 * not hide a copy.
 * @param text - Raw body source text.
 * @returns The canonical (comparable) form.
 */
export function normalizeBody(text: string): string {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/\/\/[^\n]*/g, '');
  return noLine.replace(/\s+/g, '');
}

/**
 * Best-effort function name for reporting — own name, else the enclosing
 * `const x = () => {}` / property name, else `(anonymous)`.
 * @param node - The function-like node.
 * @param sf - Its source file (for `getText`).
 * @returns A human-readable name.
 */
function fnName(node: ts.Node, sf: ts.SourceFile): string {
  const named = node as { name?: ts.Node };
  if (named.name) return named.name.getText(sf);
  const parent = node.parent as { name?: ts.Node } | undefined;
  if (parent?.name) return parent.name.getText(sf);
  return '(anonymous)';
}

/**
 * Append one function body to `out` when it clears the size floor.
 * @param sf - Source file being walked.
 * @param node - Candidate AST node.
 * @param out - Accumulator (mutated).
 * @returns Sentinel true (side-effecting helper).
 */
function pushBody(sf: ts.SourceFile, node: ts.Node, out: IBody[]): Done {
  const body = fnBlock(node);
  if (body === false) return true;
  const bodyText = body.getText(sf);
  const norm = normalizeBody(bodyText);
  if (norm.length < MIN_BODY_CHARS) return true;
  const entry = makeBody(sf, node, norm);
  out.push(entry);
  return true;
}

/**
 * Build the located, normalized body record for one function node.
 * @param sf - Source file being walked.
 * @param node - The function-like node.
 * @param norm - Its normalized body.
 * @returns The body record (repo-relative, forward-slash path).
 */
function makeBody(sf: ts.SourceFile, node: ts.Node, norm: string): IBody {
  const start = node.getStart(sf);
  const pos = sf.getLineAndCharacterOfPosition(start);
  const abs = path.relative(REPO_ROOT, sf.fileName);
  const file = abs.split(path.sep).join('/');
  const name = fnName(node, sf);
  return { file, line: pos.line + 1, name, norm };
}

/**
 * Recursively walk a node collecting every qualifying body. The
 * `forEachChild` callback returns `false` so the walk visits every child
 * (a truthy return would stop `forEachChild` after the first).
 * @param sf - Source file being walked.
 * @param node - Current node.
 * @param out - Accumulator (mutated).
 * @returns Sentinel true once the subtree is walked.
 */
function collectFromNode(sf: ts.SourceFile, node: ts.Node, out: IBody[]): Done {
  pushBody(sf, node, out);
  ts.forEachChild(node, (child): false => {
    collectFromNode(sf, child, out);
    return false;
  });
  return true;
}

/**
 * Parse one file and collect its qualifying function bodies.
 * @param file - Absolute file path.
 * @returns All bodies clearing the size floor.
 */
function collectBodies(file: string): IBody[] {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: IBody[] = [];
  collectFromNode(sf, sf, out);
  return out;
}

/**
 * Route one file's bodies into the test or production bucket.
 * @param file - Absolute file path.
 * @param prod - Production accumulator (mutated).
 * @param test - Test accumulator (mutated).
 * @returns Sentinel true (side-effecting helper).
 */
function classifyBodies(file: string, prod: IBody[], test: IBody[]): Done {
  const bodies = collectBodies(file);
  if (file.endsWith('.test.ts')) {
    test.push(...bodies);
    return true;
  }
  if (isProdFile(file)) prod.push(...bodies);
  return true;
}

/**
 * Walk `src/` and split every function body into test vs production.
 * @returns The two body buckets.
 */
function gatherBodies(): { prod: IBody[]; test: IBody[] } {
  const all: string[] = [];
  walkAllTs(SRC_ROOT, all);
  const prod: IBody[] = [];
  const test: IBody[] = [];
  for (const file of all) classifyBodies(file, prod, test);
  return { prod, test };
}

/**
 * Index production bodies by normalized text (first occurrence wins).
 * @param bodies - All production bodies.
 * @returns Map from normalized body to its source.
 */
function indexByNorm(bodies: readonly IBody[]): Map<string, IBody> {
  const map = new Map<string, IBody>();
  for (const body of bodies) if (!map.has(body.norm)) map.set(body.norm, body);
  return map;
}

/**
 * Find every test body that is byte-identical to a production body.
 * Pure — exported so a unit test drives it on synthetic bodies.
 * @param prod - Production bodies.
 * @param test - Test bodies.
 * @returns The violations (test body <-> production body).
 */
export function detectDuplicates(prod: readonly IBody[], test: readonly IBody[]): IViolation[] {
  const prodIndex = indexByNorm(prod);
  const out: IViolation[] = [];
  for (const body of test) {
    const key = `${body.file}:${body.name}`;
    if (ALLOWLIST.has(key)) continue;
    const match = prodIndex.get(body.norm);
    if (match) out.push({ test: body, prod: match });
  }
  return out;
}

/**
 * Print one violation as `test:line name <-> prod:line name`.
 * @param violation - The matched pair.
 * @returns Sentinel true (side-effecting helper).
 */
function printViolation(violation: IViolation): Done {
  const t = `${violation.test.file}:${String(violation.test.line)} ${violation.test.name}`;
  const p = `${violation.prod.file}:${String(violation.prod.line)} ${violation.prod.name}`;
  console.error(`   ${t}  <->  ${p}`);
  return true;
}

/**
 * Report violations and exit non-zero.
 * @param violations - The matched pairs.
 * @returns Never — the process exits first.
 */
function reportAndExit(violations: readonly IViolation[]): Done {
  console.error('❌ TEST DUPLICATION — test bodies identical to production logic:');
  for (const violation of violations) printViolation(violation);
  console.error('');
  console.error('   Import and reuse the production helper instead of copying its');
  console.error('   body. If the match is genuinely intentional, add the test-side');
  console.error('   `relativePath:functionName` to ALLOWLIST in');
  console.error('   src/Tests/Tools/lint-test-duplication.ts with a justifying comment.');
  process.exit(1);
}

/**
 * Drive the canary end-to-end. Importable (guarded by {@link isMainModule})
 * so unit tests can load this module without triggering a walk or exit.
 * @returns Sentinel true once the canary completes successfully.
 */
function runCanary(): Done {
  const { prod, test } = gatherBodies();
  const violations = detectDuplicates(prod, test);
  if (violations.length > 0) return reportAndExit(violations);
  console.log(
    `✅ Test-duplication canary clean — ${String(test.length)} test bodies, no production copies`,
  );
  return true;
}

/**
 * Whether this module is the process entry point (direct `tsx` run).
 * @returns True when invoked as the main module.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).endsWith('lint-test-duplication.ts');
}

/**
 * Entry-point wrapper — discards the sentinel via a typed binding.
 * @returns The sentinel emitted by the runner.
 */
function bootCanary(): Done {
  const didComplete = runCanary();
  return didComplete;
}

if (isMainModule()) bootCanary();
