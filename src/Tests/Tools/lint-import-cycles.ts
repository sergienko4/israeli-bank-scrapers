/**
 * ACYCLIC-DEPENDENCIES GATE — fails CI/commits when the production import
 * graph grows a NEW circular dependency (or grows an existing one).
 *
 * WHY (decoupling-driven, not size-driven): the campaign previously
 * measured a PROXY — per-file line count (eslint `max-lines`). Splitting a
 * god-file into barrel-fronted siblings lowers LoC while leaving the real
 * coupling — dependency CYCLES — untouched. `code-simplification-guidlines`
 * names "optimizing for line count" a failure mode; the addyosmani
 * `code-review-and-quality` skill names "no circular dependencies" the
 * canonical architecture axis. This gate measures the target directly.
 *
 * RATCHET POLICY: the committed baseline (`import-cycles.baseline.json`)
 * freezes the cycles that exist today. A current cycle PASSES only when it
 * is a SUBSET of some baseline cycle — so shrinking or splitting a known
 * cycle is allowed (burn-down), while introducing a new cycle or merging
 * two known cycles into a bigger one FAILS. The end state is an empty
 * baseline (zero cycles).
 *
 * Run `npm run lint:cycles` to check; `npm run lint:cycles -- --update-baseline`
 * to re-freeze after a deliberate, reviewed burn-down.
 *
 * TAMPER-GUARD: the working-tree baseline is itself trusted by the ratchet, so
 * a PR could add a cycle AND widen `import-cycles.baseline.json` in one diff to
 * hide it. Running with `--guard-against <base-baseline.json>` (CI passes the
 * PR's base-branch copy) asserts the committed baseline only SHRINKS — it may
 * never gain or grow a frozen cycle — closing that loophole.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseImports, resolveImport, UNRESOLVED, walkProdFiles } from './ImportGraphScan.js';

const REPO_ROOT = process.cwd();
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const BASELINE_PATH = path.join(SRC_ROOT, 'Tests', 'Tools', 'import-cycles.baseline.json');
const UPDATE_FLAG = '--update-baseline';
const GUARD_FLAG = '--guard-against';

/** Sentinel returned by side-effecting helpers (no-void rule). */
type Done = true;

/** A dependency cycle as a sorted list of repo-relative POSIX paths. */
type Cycle = readonly string[];

/** On-disk shape of the committed cycle baseline. */
interface ICycleBaseline {
  readonly note: string;
  readonly cycleCount: number;
  readonly cycles: readonly Cycle[];
}

/**
 * Forward import graph: each node maps to the internal modules it imports.
 * Built once from the production `.ts` files under `src/`.
 */
type ImportGraph = ReadonlyMap<string, readonly string[]>;

/**
 * Tarjan strongly-connected-components solver over an import graph.
 *
 * Stateful by nature (DFS index/low-link bookkeeping), so it is wrapped in
 * a single class; each method stays small and returns a sentinel to honour
 * the no-void rule. {@link compute} returns every SCC, including trivial
 * single-node ones — cycle filtering happens in {@link extractCycles}.
 */
class TarjanScc {
  private _counter = 0;

  private readonly _index = new Map<string, number>();

  private readonly _low = new Map<string, number>();

  private readonly _onStack = new Set<string>();

  private readonly _stack: string[] = [];

  private readonly _components: string[][] = [];

  /**
   * Bind the solver to one immutable import graph.
   * @param graph - Forward adjacency map (node → imported nodes).
   */
  constructor(private readonly graph: ImportGraph) {}

  /**
   * Compute every strongly-connected component of the graph.
   * @returns One array of node ids per SCC.
   */
  public compute(): string[][] {
    for (const node of this.graph.keys()) {
      const hasSeen = this._index.has(node);
      if (!hasSeen) this.visit(node);
    }
    return this._components;
  }

  /**
   * Tarjan DFS rooted at one node.
   * @param node - Node to explore.
   * @returns Completion sentinel.
   */
  private visit(node: string): Done {
    this.enter(node);
    this.scanNeighbors(node);
    this.settle(node);
    return true;
  }

  /**
   * Assign discovery index/low-link and push the node on the live stack.
   * @param node - Node being entered.
   * @returns Completion sentinel.
   */
  private enter(node: string): Done {
    this._index.set(node, this._counter);
    this._low.set(node, this._counter);
    this._counter += 1;
    this._stack.push(node);
    this._onStack.add(node);
    return true;
  }

  /**
   * Relax low-links across every out-edge of the node.
   * @param node - Node whose edges are scanned.
   * @returns Completion sentinel.
   */
  private scanNeighbors(node: string): Done {
    const neighbors = this.graph.get(node) ?? [];
    for (const next of neighbors) this.relax(node, next);
    return true;
  }

  /**
   * Visit/relax a single edge `node → next` per Tarjan's rules.
   * @param node - Source node.
   * @param next - Imported node.
   * @returns Completion sentinel.
   */
  private relax(node: string, next: string): Done {
    const isUnseen = !this._index.has(next);
    if (isUnseen) this.visit(next);
    if (isUnseen) return this.lower(node, this._low.get(next) ?? 0);
    const isLive = this._onStack.has(next);
    if (isLive) return this.lower(node, this._index.get(next) ?? 0);
    return true;
  }

  /**
   * Lower a node's low-link toward a candidate value.
   * @param node - Node to update.
   * @param candidate - Competing low-link value.
   * @returns Completion sentinel.
   */
  private lower(node: string, candidate: number): Done {
    const current = this._low.get(node) ?? 0;
    const next = Math.min(current, candidate);
    this._low.set(node, next);
    return true;
  }

  /**
   * Close a node: if it roots an SCC, pop the component off the stack.
   * @param node - Node being settled.
   * @returns Completion sentinel.
   */
  private settle(node: string): Done {
    const isRoot = this._low.get(node) === this._index.get(node);
    if (!isRoot) return true;
    return this.drain(node, []);
  }

  /**
   * Pop the live stack into one component until `root` is popped.
   * @param root - SCC root node.
   * @param component - Accumulator for the component's nodes.
   * @returns Completion sentinel.
   */
  private drain(root: string, component: string[]): Done {
    const popped = this._stack.pop() ?? root;
    this._onStack.delete(popped);
    component.push(popped);
    if (popped !== root) return this.drain(root, component);
    this._components.push(component);
    return true;
  }
}

/**
 * Convert an absolute path to a repo-relative POSIX path (stable across OSes).
 * @param file - Absolute file path.
 * @returns Repo-relative path using forward slashes.
 */
function toRelative(file: string): string {
  const rel = path.relative(REPO_ROOT, file);
  return rel.split(path.sep).join('/');
}

/**
 * Resolve one specifier and push it onto `edges` when it is an internal module.
 * @param file - Importer absolute path.
 * @param spec - Raw import specifier.
 * @param edges - Accumulator for resolved internal targets.
 * @returns Completion sentinel.
 */
function collectEdge(file: string, spec: string, edges: string[]): Done {
  const target = resolveImport(file, spec);
  const isInternal = target !== UNRESOLVED;
  if (isInternal) edges.push(target);
  return true;
}

/**
 * Resolve and record one file's internal import edges into `graph`.
 * @param file - Production file to scan.
 * @param graph - Mutable adjacency map being built.
 * @returns Completion sentinel.
 */
function addFileEdges(file: string, graph: Map<string, string[]>): Done {
  const edges: string[] = [];
  for (const spec of parseImports(file)) collectEdge(file, spec, edges);
  graph.set(file, edges);
  return true;
}

/**
 * Build the forward import graph for every production source file.
 * @param files - Absolute production `.ts` paths.
 * @returns Adjacency map (node → resolved internal imports).
 */
export function buildImportGraph(files: readonly string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of files) addFileEdges(file, graph);
  return graph;
}

/**
 * Normalise one raw SCC into a sorted list of repo-relative POSIX paths.
 * @param component - Absolute node ids of one SCC.
 * @returns Sorted repo-relative cycle.
 */
function normalizeComponent(component: readonly string[]): Cycle {
  const relative = component.map((file): string => toRelative(file));
  return [...relative].sort((a, b): number => a.localeCompare(b));
}

/**
 * Order cycles deterministically by their joined path signature.
 * @param left - First cycle.
 * @param right - Second cycle.
 * @returns Comparator result.
 */
function compareCycles(left: Cycle, right: Cycle): number {
  const a = left.join('|');
  const b = right.join('|');
  return a.localeCompare(b);
}

/**
 * True when a lone node imports itself — a self-loop Tarjan reports as a
 * singleton SCC but which is still a real dependency cycle.
 * @param node - Absolute node id to inspect.
 * @param graph - Forward import graph (to read the node's edges).
 * @returns True when the node has an edge back to itself.
 */
function hasSelfEdge(node: string, graph: ImportGraph): boolean {
  const edges = graph.get(node) ?? [];
  return edges.includes(node);
}

/**
 * A component is a true cycle when it has ≥ 2 members, or a single member
 * with a self-loop edge.
 * @param component - One SCC's absolute node ids.
 * @param graph - Forward import graph (to detect self-edges).
 * @returns True when the component represents a dependency cycle.
 */
function isCyclicComponent(component: readonly string[], graph: ImportGraph): boolean {
  if (component.length > 1) return true;
  return component.some((node): boolean => hasSelfEdge(node, graph));
}

/**
 * Extract every true dependency cycle from the graph — every multi-node SCC
 * plus any single-node SCC that imports itself.
 * @param graph - Forward import graph.
 * @returns Deterministically ordered cycles.
 */
export function extractCycles(graph: ImportGraph): Cycle[] {
  const solver = new TarjanScc(graph);
  const components = solver.compute();
  const cyclic = components.filter((c): boolean => isCyclicComponent(c, graph));
  const cycles = cyclic.map((c): Cycle => normalizeComponent(c));
  return cycles.sort(compareCycles);
}

/**
 * Decide whether `candidate`'s files are all contained in `superset`.
 * @param superset - Baseline cycle file list.
 * @param subset - Current cycle's files as a set.
 * @returns True when every current file appears in the baseline cycle.
 */
function isSuperset(superset: Cycle, subset: ReadonlySet<string>): boolean {
  const supersetFiles = new Set(superset);
  return [...subset].every((file): boolean => supersetFiles.has(file));
}

/**
 * A current cycle is allowed when some baseline cycle is its superset
 * (subset ⇒ a shrink/split of a known cycle, never a regression).
 * @param current - Current cycle.
 * @param baseline - Frozen baseline cycles.
 * @returns True when the cycle is covered by the baseline.
 */
function isAllowed(current: Cycle, baseline: readonly Cycle[]): boolean {
  const currentSet = new Set(current);
  return baseline.some((frozen): boolean => isSuperset(frozen, currentSet));
}

/**
 * Compute the cycles that are new or grown relative to the baseline.
 * @param current - Cycles in the current graph.
 * @param baseline - Frozen baseline cycles.
 * @returns Disallowed (regressing) cycles.
 */
export function findRegressions(current: readonly Cycle[], baseline: readonly Cycle[]): Cycle[] {
  return current.filter((cycle): boolean => !isAllowed(cycle, baseline));
}

/**
 * Read a cycle baseline payload's cycles from an explicit path, tolerating a
 * missing file (treated as "zero cycles" so the most-ratcheted state wins).
 * @param file - Absolute path to a baseline JSON file.
 * @returns Frozen baseline cycles.
 */
function loadBaselineFrom(file: string): readonly Cycle[] {
  const hasBaseline = fs.existsSync(file);
  if (!hasBaseline) return [];
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as ICycleBaseline;
  return parsed.cycles;
}

/**
 * Read the committed cycle baseline from the working tree (tolerating a
 * missing file so a fresh repo starts fully ratcheted).
 * @returns Frozen baseline cycles.
 */
function loadBaseline(): readonly Cycle[] {
  return loadBaselineFrom(BASELINE_PATH);
}

/**
 * Collect all production `.ts` files under `src/`.
 * @returns Absolute production file paths.
 */
function collectProdFiles(): string[] {
  const files: string[] = [];
  walkProdFiles(SRC_ROOT, files);
  return files;
}

/**
 * Compute the current cycles from a fresh scan of the source tree.
 * @returns Deterministically ordered current cycles.
 */
function currentCycles(): Cycle[] {
  const files = collectProdFiles();
  const graph = buildImportGraph(files);
  return extractCycles(graph);
}

/**
 * Serialise cycles into the on-disk baseline payload.
 * @param cycles - Cycles to freeze.
 * @returns Baseline object ready for JSON serialisation.
 */
function buildBaselinePayload(cycles: readonly Cycle[]): ICycleBaseline {
  const note =
    'Frozen dependency cycles (Tarjan SCCs, size ≥ 2). A current cycle ' +
    'passes only when it is a subset of one listed here. Burn down toward [].';
  return { note, cycleCount: cycles.length, cycles };
}

/**
 * Overwrite the baseline file with the current cycles.
 * @param cycles - Cycles to freeze.
 * @returns Completion sentinel.
 */
function writeBaseline(cycles: readonly Cycle[]): Done {
  const payload = buildBaselinePayload(cycles);
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(BASELINE_PATH, `${json}\n`, 'utf8');
  console.log(`✅ Cycle baseline updated — ${String(cycles.length)} cycle(s) frozen`);
  return true;
}

/**
 * Print one regressing cycle's files for the failure report.
 * @param cycle - Cycle to print.
 * @returns Completion sentinel.
 */
function printCycle(cycle: Cycle): Done {
  console.error(`   • cycle of ${String(cycle.length)} files:`);
  for (const file of cycle) console.error(`       ${file}`);
  return true;
}

/**
 * Report new/grown cycles and exit non-zero (never returns on failure).
 * @param regressions - Disallowed cycles.
 * @returns Completion sentinel (only reached when there are none).
 */
function reportRegressions(regressions: readonly Cycle[]): Done {
  console.error('❌ ACYCLIC-DEPENDENCIES — new or grown dependency cycle(s) detected:');
  for (const cycle of regressions) printCycle(cycle);
  console.error('');
  console.error('   You added an import that closes a NEW cycle (or merged two');
  console.error('   frozen cycles). Break the back-edge — invert the dependency,');
  console.error('   inject via a contract, or move the shared type to Types/**.');
  console.error('   Do NOT widen the baseline to hide a regression.');
  process.exit(1);
}

/**
 * Evaluate the gate against the baseline and report the outcome.
 * @param cycles - Current cycles.
 * @param baseline - Frozen baseline cycles.
 * @returns Completion sentinel.
 */
function evaluateGate(cycles: readonly Cycle[], baseline: readonly Cycle[]): Done {
  const regressions = findRegressions(cycles, baseline);
  if (regressions.length > 0) return reportRegressions(regressions);
  console.log(
    `✅ Acyclic-dependencies gate clean — ${String(cycles.length)} cycle(s), ` +
      'all within the frozen baseline',
  );
  return true;
}

/**
 * Read the `--guard-against <path>` flag value — the base-branch baseline the
 * working-tree baseline must not have widened beyond.
 * @returns The base baseline path, or '' when the flag is absent.
 */
function readGuardPath(): string {
  const flagAt = process.argv.indexOf(GUARD_FLAG);
  if (flagAt < 0) return '';
  return process.argv[flagAt + 1] ?? '';
}

/**
 * Whether the tamper-guard flag was supplied on the command line.
 * @returns True when `--guard-against` is present in argv.
 */
function hasGuardFlag(): boolean {
  return process.argv.includes(GUARD_FLAG);
}

/**
 * Report a `--guard-against` flag supplied without a base baseline path and
 * exit non-zero (never returns) so a mis-invocation fails loud instead of
 * silently disabling the guard.
 * @returns Completion sentinel (unreachable — the process exits first).
 */
function reportMissingGuardPath(): Done {
  console.error(`❌ ${GUARD_FLAG} requires a base baseline file path.`);
  process.exit(1);
}

/**
 * Report a baseline that WIDENED versus the base branch and exit non-zero
 * (never returns).
 * @param widened - Baseline cycles new or grown relative to the base.
 * @returns Completion sentinel (unreachable — the process exits first).
 */
function reportWidening(widened: readonly Cycle[]): Done {
  console.error('❌ ACYCLIC-DEPENDENCIES — committed cycle baseline WIDENED vs. the base branch:');
  for (const cycle of widened) printCycle(cycle);
  console.error('');
  console.error('   The baseline may only SHRINK (burn-down). A new or grown frozen entry');
  console.error('   usually hides a freshly introduced import cycle. Revert the baseline');
  console.error('   edit and break the back-edge instead of widening the ratchet.');
  process.exit(1);
}

/**
 * Assert the working-tree baseline did not widen against the base baseline.
 * Widening is exactly a {@link findRegressions} of the PR baseline against the
 * base baseline (a frozen entry that is neither absent nor a subset).
 * @param prBaseline - Baseline committed on this branch.
 * @param baseBaseline - Baseline on the PR's target branch.
 * @returns Completion sentinel (only reached when the baseline did not widen).
 */
function evaluateGuard(prBaseline: readonly Cycle[], baseBaseline: readonly Cycle[]): Done {
  const widened = findRegressions(prBaseline, baseBaseline);
  if (widened.length > 0) return reportWidening(widened);
  console.log(
    '✅ Cycle baseline tamper-guard clean — baseline did not widen ' +
      `(${String(prBaseline.length)} cycle(s) frozen)`,
  );
  return true;
}

/**
 * Run the tamper-guard: compare the working-tree baseline against the base
 * branch's baseline so a PR cannot loosen the ratchet to hide a new cycle.
 * @param basePath - Path to the base branch's baseline JSON.
 * @returns Completion sentinel.
 */
function runGuard(basePath: string): Done {
  if (basePath === '') return reportMissingGuardPath();
  const prBaseline = loadBaseline();
  const baseBaseline = loadBaselineFrom(basePath);
  return evaluateGuard(prBaseline, baseBaseline);
}

/**
 * Drive the gate: scan, then either re-freeze the baseline or evaluate it.
 * @returns Completion sentinel.
 */
function runCycleGate(): Done {
  if (hasGuardFlag()) {
    const guardPath = readGuardPath();
    return runGuard(guardPath);
  }
  const cycles = currentCycles();
  const isUpdating = process.argv.includes(UPDATE_FLAG);
  if (isUpdating) return writeBaseline(cycles);
  const baseline = loadBaseline();
  return evaluateGate(cycles, baseline);
}

/**
 * Detect whether this module is the process entry point, so the gate's
 * side effects fire only under direct `tsx` invocation and never when a
 * unit test imports the pure helpers.
 * @returns True when invoked as the main module.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).endsWith('lint-import-cycles.ts');
}

/**
 * Entry wrapper that discards the sentinel via a typed binding so the
 * call site stays clear of the no-void / naming-convention rules.
 * @returns The sentinel emitted by the gate runner.
 */
function bootCycleGate(): Done {
  const didComplete = runCycleGate();
  return didComplete;
}

if (isMainModule()) bootCycleGate();
