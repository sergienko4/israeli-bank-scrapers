#!/usr/bin/env node
/**
 * Compares two decoupling snapshots and emits a Markdown matrix.
 *
 * Usage:
 *   node scripts/decoupling-metrics/diff.mjs <before.json> <after.json>
 *
 * Intended for the post-PR checklist (step C5): paste the output into the
 * phase status doc to prove a change actually decoupled the code.
 */
import { readFileSync } from 'node:fs';

const CLUSTER_ROWS = 15;

function load(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function delta(before, after) {
  const d = after - before;
  if (d === 0) return '—';
  return d > 0 ? `+${d}` : `${d}`;
}

function row(label, before, after, betterWhenLower = true) {
  const d = after - before;
  const arrow = d === 0 ? '' : (d < 0) === betterWhenLower ? ' ✅' : ' ⚠️';
  return `| ${label} | ${before} | ${after} | ${delta(before, after)}${arrow} |`;
}

function headline(a, b) {
  return [
    '| Metric | Before | After | Δ |',
    '|---|---:|---:|---:|',
    row('Files', a.summary.files, b.summary.files, false),
    row('Import edges', a.summary.edges, b.summary.edges),
    row('Avg fan-out', a.summary.avgFanOut, b.summary.avgFanOut),
    row('Import cycles', a.cycles.count, b.cycles.count),
    row('Largest cycle', a.cycles.largest, b.cycles.largest),
    row('Canaries', a.guardrails.canaries, b.guardrails.canaries, false),
    row('ESLint rules', a.guardrails.eslintRules, b.guardrails.eslintRules, false),
    row('`any` usages', a.guardrails.anyUsages, b.guardrails.anyUsages),
  ].join('\n');
}

function surfaceLine(a, b) {
  const before = a.guardrails.publicSurface;
  const after = b.guardrails.publicSurface;
  if (!before.present || !after.present) return '_Public surface: `lib/index.cjs` not built in one or both snapshots._';
  const same = before.sha256 === after.sha256;
  return same
    ? '✅ Public surface byte-identical (`lib/index.cjs` sha256 unchanged).'
    : `⚠️ Public surface CHANGED — ${before.bytes} → ${after.bytes} bytes. Confirm this was intended.`;
}

function indexClusters(snap) {
  return new Map(snap.clusters.map((c) => [c.cluster, c]));
}

function clusterRows(a, b) {
  const before = indexClusters(a);
  const rows = [];
  for (const c of b.clusters) {
    const prev = before.get(c.cluster);
    if (!prev) rows.push({ cluster: c.cluster, note: 'new', shift: c.loc });
    else if (prev.cohesion !== c.cohesion || prev.loc !== c.loc) {
      rows.push({ cluster: c.cluster, prev, cur: c, shift: Math.abs(c.loc - prev.loc) });
    }
  }
  return rows.sort((x, y) => y.shift - x.shift).slice(0, CLUSTER_ROWS);
}

function renderClusters(rows) {
  if (rows.length === 0) return '_No cluster changed._';
  const head = ['| Cluster | LoC | Cohesion | Fan-out (external) |', '|---|---|---|---|'];
  const body = rows.map((r) =>
    r.note === 'new'
      ? `| \`${r.cluster}\` | — → ${r.shift} | — | — | (new)`
      : `| \`${r.cluster}\` | ${r.prev.loc} → ${r.cur.loc} | ${r.prev.cohesion} → ${r.cur.cohesion} | ${r.prev.outgoing} → ${r.cur.outgoing} |`,
  );
  return [...head, ...body].join('\n');
}

function main() {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.error('usage: node diff.mjs <before.json> <after.json>');
    process.exit(1);
  }
  const a = load(beforePath);
  const b = load(afterPath);
  console.log(`# Decoupling matrix — ${a.label} → ${b.label}\n`);
  console.log(`\`${a.gitCommitHash.slice(0, 8)}\` → \`${b.gitCommitHash.slice(0, 8)}\`\n`);
  console.log(`${headline(a, b)}\n`);
  console.log(`${surfaceLine(a, b)}\n`);
  console.log('## Cluster shifts\n');
  console.log(renderClusters(clusterRows(a, b)));
}

main();
