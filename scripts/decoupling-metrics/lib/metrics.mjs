/**
 * Coupling metrics derived from a file-level import graph.
 *
 * Reports Martin-style afferent/efferent coupling and instability per file,
 * cohesion per cluster, and strongly-connected components (import cycles).
 */

const CLUSTER_DEPTH = 4;

function emptyCounts(files) {
  return new Map(files.map(f => [f, 0]));
}

function instability(fanIn, fanOut) {
  const total = fanIn + fanOut;
  return total === 0 ? 0 : Number((fanOut / total).toFixed(3));
}

/** Per-file afferent (fanIn), efferent (fanOut) coupling and instability. */
export function couplingByFile({ files, edges }) {
  const fanIn = emptyCounts(files);
  const fanOut = emptyCounts(files);
  for (const [from, to] of edges) {
    fanOut.set(from, fanOut.get(from) + 1);
    fanIn.set(to, fanIn.get(to) + 1);
  }
  return files.map(f => ({
    file: f,
    fanIn: fanIn.get(f),
    fanOut: fanOut.get(f),
    instability: instability(fanIn.get(f), fanOut.get(f)),
  }));
}

/** Maps a file to its cluster key (its first `CLUSTER_DEPTH` path segments). */
export function clusterOf(file) {
  const parts = file.split('/');
  return parts.slice(0, Math.min(CLUSTER_DEPTH, parts.length - 1)).join('/') || '(root)';
}

function tallyCluster(acc, key) {
  if (!acc.has(key)) {
    acc.set(key, { cluster: key, files: 0, loc: 0, internalEdges: 0, outgoing: 0, incoming: 0 });
  }
  return acc.get(key);
}

function addClusterEdges(acc, edges) {
  for (const [from, to] of edges) {
    const a = clusterOf(from);
    const b = clusterOf(to);
    if (a === b) tallyCluster(acc, a).internalEdges += 1;
    else {
      tallyCluster(acc, a).outgoing += 1;
      tallyCluster(acc, b).incoming += 1;
    }
  }
}

function cohesion(c) {
  const total = c.internalEdges + c.outgoing;
  return total === 0 ? 1 : Number((c.internalEdges / total).toFixed(3));
}

/** Per-cluster size plus internal/external edge split and cohesion ratio. */
export function clusterMetrics({ files, edges, loc }) {
  const acc = new Map();
  for (const f of files) {
    const c = tallyCluster(acc, clusterOf(f));
    c.files += 1;
    c.loc += loc.get(f) ?? 0;
  }
  addClusterEdges(acc, edges);
  return [...acc.values()]
    .map(c => ({ ...c, cohesion: cohesion(c) }))
    .sort((a, b) => b.loc - a.loc);
}

function adjacency(files, edges) {
  const adj = new Map(files.map(f => [f, []]));
  for (const [from, to] of edges) adj.get(from)?.push(to);
  return adj;
}

function strongConnect(node, ctx) {
  ctx.index.set(node, ctx.counter);
  ctx.low.set(node, ctx.counter++);
  ctx.stack.push(node);
  ctx.onStack.add(node);
  for (const next of ctx.adj.get(node) ?? []) visitNeighbour(node, next, ctx);
  if (ctx.low.get(node) === ctx.index.get(node)) popComponent(node, ctx);
}

function visitNeighbour(node, next, ctx) {
  if (!ctx.index.has(next)) {
    strongConnect(next, ctx);
    ctx.low.set(node, Math.min(ctx.low.get(node), ctx.low.get(next)));
  } else if (ctx.onStack.has(next)) {
    ctx.low.set(node, Math.min(ctx.low.get(node), ctx.index.get(next)));
  }
}

function popComponent(root, ctx) {
  const group = [];
  let member;
  do {
    member = ctx.stack.pop();
    ctx.onStack.delete(member);
    group.push(member);
  } while (member !== root);
  if (group.length > 1) ctx.components.push(group.sort());
}

/** Import cycles as strongly-connected components of size > 1. */
export function importCycles({ files, edges }) {
  const ctx = {
    adj: adjacency(files, edges),
    index: new Map(),
    low: new Map(),
    stack: [],
    onStack: new Set(),
    components: [],
    counter: 0,
  };
  for (const f of files) if (!ctx.index.has(f)) strongConnect(f, ctx);
  return ctx.components.sort((a, b) => b.length - a.length);
}
