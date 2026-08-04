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

/**
 * Weight applied to a cohesion delta when ranking cluster shifts, chosen so a
 * 0.1 cohesion move ranks alongside a 100-LoC move.
 */
const COHESION_WEIGHT = 1000;

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
  const arrow = d === 0 ? '' : d < 0 === betterWhenLower ? ' ✅' : ' ⚠️';
  return `| ${label} | ${before} | ${after} | ${delta(before, after)}${arrow} |`;
}

/** Headline rows as data so the renderer stays within the function-size cap. */
const HEADLINE_ROWS = [
  ['Files', s => s.summary.files, false],
  ['Runtime edges', s => s.runtimeSummary.edges, true],
  ['Avg runtime fan-out', s => s.runtimeSummary.avgFanOut, true],
  ['Import cycles', s => s.cycles.count, true],
  ['Largest cycle', s => s.cycles.largest, true],
  ['All edges (recompilation scope)', s => s.summary.edges, true],
  ['Canaries', s => s.guardrails.canaries, false],
  ['ESLint rules', s => s.guardrails.eslintRules, false],
  ['`any` usages', s => s.guardrails.anyUsages, true],
];

function headline(a, b) {
  const body = HEADLINE_ROWS.map(([label, pick, lower]) => row(label, pick(a), pick(b), lower));
  return ['| Metric | Before | After | Δ |', '|---|---:|---:|---:|', ...body].join('\n');
}

function surfaceLine(a, b) {
  const before = a.guardrails.publicSurface;
  const after = b.guardrails.publicSurface;
  if (!before.present || !after.present)
    return '_Public surface: `lib/index.cjs` not built in one or both snapshots._';
  const same = before.sha256 === after.sha256;
  return same
    ? '✅ Public surface byte-identical (`lib/index.cjs` sha256 unchanged).'
    : `⚠️ Public surface CHANGED — ${before.bytes} → ${after.bytes} bytes. Confirm this was intended.`;
}

function indexClusters(snap) {
  return new Map(snap.runtimeClusters.map(c => [c.cluster, c]));
}

/**
 * Ranks how much a cluster moved.
 *
 * <p>Cohesion is weighted so a cohesion-only shift outranks a trivial LoC
 * change; ranking on LoC alone scored those at zero and sliced them out of
 * the table entirely.
 */
function rank(prev, cur) {
  return Math.abs(cur.loc - prev.loc) + Math.abs(cur.cohesion - prev.cohesion) * COHESION_WEIGHT;
}

function changedRow(prev, cur) {
  if (prev.cohesion === cur.cohesion && prev.loc === cur.loc) return null;
  return { cluster: cur.cluster, prev, cur, shift: rank(prev, cur) };
}

function rowFor(prev, cur) {
  if (!prev) return { cluster: cur.cluster, cur, note: 'new', shift: cur.loc };
  return changedRow(prev, cur);
}

function addedOrChanged(after, before) {
  return after.map(cur => rowFor(before.get(cur.cluster), cur)).filter(Boolean);
}

function removedRows(before, after) {
  const kept = new Set(after.map(c => c.cluster));
  return [...before.values()]
    .filter(c => !kept.has(c.cluster))
    .map(c => ({ cluster: c.cluster, prev: c, note: 'removed', shift: c.loc }));
}

function clusterRows(a, b) {
  const before = indexClusters(a);
  const after = b.runtimeClusters;
  const rows = [...addedOrChanged(after, before), ...removedRows(before, after)];
  return rows.sort((x, y) => y.shift - x.shift).slice(0, CLUSTER_ROWS);
}

/** Renders the three value cells, marking a cluster that only exists on one side. */
function arrowCells(prev, cur, mark) {
  const at = (o, k) => (o ? o[k] : '—');
  return [
    `${at(prev, 'loc')} → ${at(cur, 'loc')}${mark}`,
    `${at(prev, 'cohesion')} → ${at(cur, 'cohesion')}`,
    `${at(prev, 'outgoing')} → ${at(cur, 'outgoing')}`,
  ];
}

function clusterCells(r) {
  if (r.note === 'new') return arrowCells(null, r.cur, ' (new)');
  if (r.note === 'removed') return arrowCells(r.prev, null, ' (removed)');
  return arrowCells(r.prev, r.cur, '');
}

function renderClusters(rows) {
  if (rows.length === 0) return '_No cluster changed._';
  const head = ['| Cluster | LoC | Cohesion | Fan-out (external) |', '|---|---|---|---|'];
  const body = rows.map(r => `| \`${r.cluster}\` | ${clusterCells(r).join(' | ')} |`);
  return [...head, ...body].join('\n');
}

function render(a, b) {
  console.log(`# Decoupling matrix — ${a.label} → ${b.label}\n`);
  console.log(`\`${a.gitCommitHash.slice(0, 8)}\` → \`${b.gitCommitHash.slice(0, 8)}\`\n`);
  console.log(`${headline(a, b)}\n`);
  console.log(`${surfaceLine(a, b)}\n`);
  console.log('## Cluster shifts\n');
  console.log(renderClusters(clusterRows(a, b)));
}

function main() {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.error('usage: node diff.mjs <before.json> <after.json>');
    process.exit(1);
  }
  render(load(beforePath), load(afterPath));
}

main();
