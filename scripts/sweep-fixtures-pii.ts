#!/usr/bin/env tsx
/**
 * One-shot sweep: re-apply {@link redactPii} from the upgraded
 * PiiRedactor to every committed bank fixture (HTML + JSON + NDJSON).
 *
 * Use after the redactor regex catalog has been extended so previously
 * committed fixtures inherit the new scrubbing rules. Safe to re-run:
 * idempotent (already-redacted text contains no PII patterns the
 * scrubber would re-match).
 *
 * USAGE:
 *   npx tsx scripts/sweep-fixtures-pii.ts
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { redactPii } from '../src/Tests/Integration/Tools/PiiRedactor.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FIXTURES = join(ROOT, 'src', 'Tests', 'Integration', 'fixtures', 'banks');
const SCRUBBABLE = /\.(html|json|ndjson)$/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SCRUBBABLE.test(entry)) out.push(full);
  }
  return out;
}

function sweepOne(file: string): { changed: boolean; bytesBefore: number; bytesAfter: number } {
  const raw = readFileSync(file, 'utf8');
  const scrubbed = redactPii(raw);
  if (scrubbed === raw) return { changed: false, bytesBefore: raw.length, bytesAfter: raw.length };
  writeFileSync(file, scrubbed, { encoding: 'utf8' });
  return { changed: true, bytesBefore: raw.length, bytesAfter: scrubbed.length };
}

function main(): void {
  const files = walk(FIXTURES);
  console.log(`Sweeping ${files.length} fixture files...`);
  let changed = 0;
  for (const f of files) {
    const res = sweepOne(f);
    if (res.changed) {
      changed++;
      const rel = relative(ROOT, f);
      console.log(`  CHANGED ${rel}  (${res.bytesBefore} -> ${res.bytesAfter} bytes)`);
    }
  }
  console.log(`\nDone. ${changed}/${files.length} files modified.`);
}

main();
