#!/usr/bin/env node
/** Exit 0 reports findings or verified clean; exit 2 preserves the previous issue on failure. */
import { appendFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { collectAuditReport } from './npm-audit/scan.mjs';

function summary(body) {
  process.stdout.write(body);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
}

try {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('AUDIT_USAGE');
  const report = collectAuditReport();
  writeFileSync(values.out, report.body);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `clean=${report.clean}\n`);
  summary(report.body);
} catch (error) {
  const code =
    error instanceof Error && /^AUDIT_[A-Z_]+$/.test(error.message)
      ? error.message
      : 'AUDIT_INTERNAL';
  summary(
    `## npm dependency audit failed\n\n${code}: scan is unverified; previous issue report is unchanged.\n`,
  );
  process.stderr.write(`npm dependency audit failed: ${code}\n`);
  process.exitCode = 2;
}
