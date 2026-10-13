#!/usr/bin/env node
/**
 * Browser-stack gate CLI. The logic lives in `scripts/browser-stack/gate.mjs`.
 *
 * Usage:
 *   node scripts/check-browser-stack.mjs [--playwright <x.y.z>] [--camoufox <tag>]
 *     [--mode gate|candidate] [--json]
 *
 * Defaults: playwright-core from `package-lock.json`, Camoufox tag from
 * `browser-stack.json`, mode `gate`.
 *
 * Exit codes: 0 pass · 1 incompatible, stale or drifted, per mode · 2 the gate
 * cannot decide. The gate is imported dynamically so that a missing module or
 * any unexpected error also exits 2 — a crash never reads as a verdict.
 */
import process from 'node:process';

try {
  const { runGate } = await import('./browser-stack/gate.mjs');
  process.exitCode = await runGate(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`INTERNAL ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 2;
}
