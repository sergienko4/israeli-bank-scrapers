#!/usr/bin/env node
/**
 * Renders the `## Upgrading to X.Y.Z` section appended to a GitHub Release.
 *
 * Why this script exists: the release body previously listed raw commit
 * subjects, which answers "what changed" but not "do I have to do
 * anything". Someone upgrading had to infer impact from a changelog. The
 * 8.3.0 removal of the `OneZeroScraper` export shows the cost of that -
 * it shipped on a MINOR bump and nobody was told to migrate.
 *
 * Every release gets this section, including quiet ones: stating "no
 * action required" explicitly is what makes the section trustworthy, and
 * silence indistinguishable from an oversight.
 *
 * Usage:
 *   node scripts/upgrade-notes.mjs --version 8.6.6
 *   node scripts/upgrade-notes.mjs --tag v8.6.6
 *
 * Exit codes:
 *   0  - section written to stdout
 *   2  - usage error (no version supplied)
 */
import { argv, exit, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { IMPACT_LABEL, readData } from './build-compatibility.mjs';

const DOCS_URL = 'https://sergienko4.github.io/israeli-bank-scrapers/compatibility/';

/**
 * Extracts the target version from `--version` or `--tag`.
 * @param args Argument vector to read; defaults to the process argv.
 * @returns Version string without a leading `v`, or null.
 */
export function parseVersion(args = argv) {
  const flag = args.findIndex((a) => a === '--version' || a === '--tag');
  if (flag === -1) return null;
  const value = args[flag + 1];
  // Reject a candidate that is itself an option: `--version --tag v9.0.0`
  // would otherwise render notes headed "Upgrading to --tag".
  if (!value || value.startsWith('--')) return null;
  return value.replace(/^v/, '');
}

/**
 * Renders a fenced snippet, or nothing when absent.
 * @param label Heading shown above the snippet.
 * @param code Snippet body, or null.
 * @returns Markdown lines.
 */
function renderSnippet(label, code) {
  if (!code) return [];
  return ['', `${label}:`, '', '```js', code, '```'];
}

/**
 * Renders the body for a release that needs user action.
 * @param entry Matching compatibility entry.
 * @returns Markdown lines.
 */
function renderAction(entry) {
  return [
    `**${IMPACT_LABEL[entry.impact]} — ${entry.title}**`,
    '',
    entry.detail,
    '',
    `**What to do:** ${entry.action}`,
    ...renderSnippet('Before', entry.before),
    ...renderSnippet('After', entry.after),
  ];
}

/** @returns Markdown lines for a release with nothing to do. */
function renderNoAction() {
  return ['No action required — this is a drop-in upgrade.'];
}

/**
 * Renders the whole section.
 * @param version Target version, without a leading `v`.
 * @param data Parsed compatibility document.
 * @returns Complete Markdown section.
 */
export function renderSection(version, data) {
  const entry = data.entries.find((e) => e.version === version);
  const body = entry ? renderAction(entry) : renderNoAction();
  const lines = [`## Upgrading to ${version}`, '', ...body, '', `Requires Node ${data.runtime.node}.`, '', `Full upgrade notes: ${DOCS_URL}`];
  return `${lines.join('\n')}\n`;
}

/** Entry point: resolve the version, then print the section. */
function main() {
  const version = parseVersion();
  if (!version) {
    stderr.write('usage: node scripts/upgrade-notes.mjs --version <x.y.z>\n');
    exit(2);
  }
  stdout.write(renderSection(version, readData()));
}

// Only run the CLI when invoked directly, so the renderer above can be
// imported by tests without printing to stdout or exiting on a missing flag.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main();
}
