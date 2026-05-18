#!/usr/bin/env node
/**
 * Cross-platform wrapper around the SonarScanner CLI.
 *
 * Wraps the `sonar-scanner` binary so `npm run sonar:scan` works on
 * Windows cmd.exe in addition to POSIX shells. The package.json script
 * previously used POSIX `${SONAR_TOKEN}` expansion which fails on
 * Windows cmd.exe (cmd.exe needs `%SONAR_TOKEN%`). Reading the env
 * var in Node and forwarding it as a CLI flag sidesteps the
 * shell-syntax mismatch entirely. CodeRabbit finding on PR #235.
 *
 * The pre-commit hook (`.husky/pre-commit`) runs the scanner
 * directly under bash — it does NOT go through this wrapper — so
 * the path here is reserved for the explicit `npm run sonar:scan`
 * developer invocation.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const token = process.env.SONAR_TOKEN;
if (!token) {
  process.stderr.write(
    'SONAR_TOKEN is not set. Source .env or export the variable in your shell.\n',
  );
  process.exit(1);
}

const result = spawnSync('sonar-scanner', [`-Dsonar.token=${token}`], {
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  process.stderr.write(
    `sonar-scanner not found on PATH. Install via 'scoop install sonar-scanner' (Windows) or the official tarball.\n`,
  );
  process.exit(127);
}

process.exit(result.status ?? 1);
