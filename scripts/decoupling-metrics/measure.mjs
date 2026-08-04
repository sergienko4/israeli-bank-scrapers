#!/usr/bin/env node
/**
 * Captures a decoupling snapshot for the post-PR checklist (step C5).
 *
 * Usage:
 *   node scripts/decoupling-metrics/measure.mjs [repoRoot] [label] [outFile]
 *
 * Writes `snapshots/<outFile>` — defaulting to `<sha>-<label>.json` — next to
 * this script and prints a short summary. Pair with `diff.mjs` to prove a
 * change actually decoupled.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGraph, RUNTIME } from './lib/graph.mjs';
import { couplingByFile, clusterMetrics, importCycles } from './lib/metrics.mjs';
import { guardrails } from './lib/guardrails.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOP_N = 25;

function headSha(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function summarise(coupling) {
  const sorted = [...coupling].sort((a, b) => b.fanIn - a.fanIn);
  const totalEdges = coupling.reduce((n, c) => n + c.fanOut, 0);
  return {
    files: coupling.length,
    edges: totalEdges,
    avgFanOut: Number((totalEdges / Math.max(coupling.length, 1)).toFixed(2)),
    topFanIn: sorted.slice(0, TOP_N),
    topFanOut: [...coupling].sort((a, b) => b.fanOut - a.fanOut).slice(0, TOP_N),
  };
}

function buildSnapshot(root, label) {
  const graph = buildGraph(root);
  const runtime = { ...graph, edges: graph.edges.filter(e => e[2] === RUNTIME) };
  const cycles = importCycles(runtime);
  return {
    label,
    gitCommitHash: headSha(root),
    capturedAt: new Date().toISOString(),
    summary: summarise(couplingByFile(graph)),
    runtimeSummary: summarise(couplingByFile(runtime)),
    clusters: clusterMetrics(graph),
    runtimeClusters: clusterMetrics(runtime),
    cycles: {
      count: cycles.length,
      largest: cycles[0]?.length ?? 0,
      components: cycles.slice(0, 10),
    },
    guardrails: guardrails(root, graph.files),
  };
}

function report(snap, outPath) {
  const { summary, runtimeSummary: rt, clusters, cycles, guardrails: g } = snap;
  console.log(`snapshot   ${snap.label} @ ${snap.gitCommitHash.slice(0, 8)}`);
  console.log(`files      ${summary.files}`);
  console.log(
    `edges      ${summary.edges} total | ${rt.edges} runtime (${summary.edges - rt.edges} type-only)`,
  );
  console.log(`avg fanout ${summary.avgFanOut} total | ${rt.avgFanOut} runtime`);
  console.log(
    `clusters   ${clusters.length}   runtime cycles ${cycles.count} (largest ${cycles.largest})`,
  );
  console.log(
    `guardrails canaries ${g.canaries}  eslintRules ${g.eslintRules}  any ${g.anyUsages}`,
  );
  console.log(`wrote      ${outPath}`);
}

function main() {
  const root = resolve(process.argv[2] ?? process.cwd());
  const label = process.argv[3] ?? 'baseline';
  const snap = buildSnapshot(root, label);
  const dir = join(HERE, 'snapshots');
  mkdirSync(dir, { recursive: true });
  const name = process.argv[4] ?? `${snap.gitCommitHash.slice(0, 8)}-${label}.json`;
  const outPath = join(dir, name);
  writeFileSync(outPath, `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
  report(snap, outPath);
}

main();
