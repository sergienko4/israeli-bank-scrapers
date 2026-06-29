#!/usr/bin/env node
// Fail CI when any E2E-Real deployment group lacks its approval-gate triad.
//
// GitHub has no native "every matrix group requires an approval gate" rule
// (required reviewers are per-environment, owner-set). Group C and Group E
// were each nearly shipped with a runner job but NO gate. This guard parses
// pr.yml and asserts, for every `e2e-real-group-X` runner: (1) a matching
// `…-gate` job exists, (2) the gate pins `environment: e2e-real-group-X`
// (distinct per group → one approval click each), (3) the runner `needs:`
// the gate. Pure, dependency-free (no transitive js-yaml reliance).
import { readFileSync } from 'node:fs';
import { argv, stderr, stdout, exit } from 'node:process';

const WORKFLOW = '.github/workflows/pr.yml';
const JOB = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const RUNNER = /^e2e-real-group-[a-z]+$/;

/** @returns workflow path from argv or the default pr.yml. */
function workflowPath() {
  const fileIdx = argv.indexOf('--file');
  return fileIdx !== -1 && argv[fileIdx + 1] ? argv[fileIdx + 1] : WORKFLOW;
}

/** Split the workflow into 2-space job blocks keyed by job name. */
function jobBlocks(text) {
  const blocks = {};
  let name = '';
  for (const line of text.split('\n')) {
    const m = JOB.exec(line);
    if (m) (name = m[1]), (blocks[name] = []);
    else if (name) blocks[name].push(line);
  }
  return blocks;
}

/** @returns true when the gate block pins `environment: <runner>`. */
function gateBindsEnv(block, runner) {
  return (block ?? []).some((l) => l.trim() === `environment: ${runner}`);
}

/** @returns true when the runner `needs:` its own gate. */
function runnerNeedsGate(block, runner) {
  return block.some((l) => /^\s*needs:/.test(l) && l.includes(`${runner}-gate`));
}

/** Collect every gate-triad violation for one runner. */
function offenders(runner, blocks) {
  const gate = blocks[`${runner}-gate`];
  const bad = [];
  if (!gate) bad.push(`${runner}: missing gate job ${runner}-gate`);
  else if (!gateBindsEnv(gate, runner)) bad.push(`${runner}: gate lacks environment: ${runner}`);
  if (!runnerNeedsGate(blocks[runner], runner)) bad.push(`${runner}: runner needs: must include ${runner}-gate`);
  return bad;
}

const blocks = jobBlocks(readFileSync(workflowPath(), 'utf8'));
const runners = Object.keys(blocks).filter((n) => RUNNER.test(n));
const failures = runners.flatMap((r) => offenders(r, blocks));
if (failures.length > 0) {
  stderr.write('E2E-Real gate-matrix coverage FAILED — every group needs a gate triad:\n');
  for (const f of failures) stderr.write(`  - ${f}\n`);
  exit(1);
}
stdout.write(`E2E-Real gate-matrix OK — ${runners.length} groups, each gated.\n`);
