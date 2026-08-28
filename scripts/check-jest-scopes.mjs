#!/usr/bin/env node
/**
 * Assert that no test script silently runs a suite the gated run excludes.
 *
 * Why this script exists: Jest's `--testPathIgnorePatterns` CLI flag REPLACES
 * the value declared in the config file — it does not extend it. That is easy
 * to miss, because the flag is repeatable, so a script that passes it three
 * times reads like it is adding three exclusions to the existing set. It is
 * not. It is discarding the config's list and substituting its own.
 *
 * The concrete failure this was written for: `test:unit` passed three `E2e*`
 * exclusions on the CLI and thereby dropped `Tests/Integration/` from the base
 * config, pulling twelve serial-only suites — every `.modeA` bank suite, each
 * declaring `--maxWorkers=1 --forceExit` for a reason — into the parallel unit
 * run. Nothing failed. The suites passed, so the only visible symptom was that
 * `npm run test:unit` took about five minutes rather than under three.
 *
 * That is the shape of the bug worth gating: it is silent, it is invisible in
 * a green run, and the mechanism that causes it looks like the opposite of
 * what it does.
 *
 * HOW IT DECIDES, AND WHY IT CHANGED. Earlier revisions of this gate parsed
 * the scripts themselves — matching flag spellings, compiling the patterns the
 * way Jest compiles them, and reasoning about the result. That approach was
 * wrong in a way that kept looking right: re-implementing Jest's selection
 * semantics from the outside is an unbounded surface, so every review found
 * another spelling it had missed. Three concrete escapes proved the point.
 * `--test-path-ignore-patterns` is the same flag as `--testPathIgnorePatterns`,
 * because Jest's parser camel-cases arguments, and it widened `test:unit` from
 * 626 suites to 662 while the gate reported a clean tree. `--testPathPatterns`
 * is matched case-insensitively, so a lowercase `tests/integration/` reached
 * all twelve serial suites — the original defect verbatim — and the gate again
 * saw nothing. And a `--config` the gate permitted could redirect discovery
 * entirely through `projects`, `roots` or `testMatch`, none of which it read.
 *
 * So it no longer imitates Jest. It asks Jest. Every script's own command line
 * is run with `--listTests --json` appended, and the answer is the set of files
 * that script would actually execute. Flag spelling, flag aliases, precedence
 * between selectors and ignores, `<rootDir>` substitution, patterns embedded in
 * a config rather than passed on the command line — all of it is decided by the
 * same code that will decide it at run time, because it IS that code. Listing
 * costs about a second per script and settles questions that no amount of
 * pattern arithmetic could settle correctly.
 *
 * The comparison is against `test:pipeline`, the run CI gates on, which makes
 * that run this repo's operative definition of a suite that is safe to execute
 * unattended. A script that reaches past it is not thereby wrong — some exist
 * precisely to run what the gated run hides — so escapes are not banned. They
 * are DECLARED, with a reason, below. An undeclared escape fails, and so does a
 * declaration that no longer describes a real one, which stops the table from
 * rotting into a rubber stamp.
 *
 * Scope, stated honestly. This reasons about which files a script SELECTS. It
 * does not run them, so it cannot prove a selected suite passes. It cannot tell
 * an over-broad exclusion from a deliberate one: the old `test:unit` hid three
 * ordinary unit suites whose names merely began with `E2eReal`, and this gate
 * would not have noticed. And a script that builds its Jest command inside a
 * source file cannot have `--listTests` appended to it, so its scope is not
 * checked at all — it is named in ORCHESTRATORS and taken on trust, with the
 * gate failing if such a script appears without a declaration. Two exist, both
 * operator-run; see that table for why an unchecked scope is tolerable there.
 *
 * What it does NOT protect against: the pre-commit hook runs it against the
 * working tree, like every other gate in that hook, so a scope repaired in the
 * worktree but left broken in the index would pass. Silent scope drift is what
 * rots unnoticed; a failing suite is loud.
 *
 * Usage:
 *   node scripts/check-jest-scopes.mjs
 *
 * Exit codes:
 *   0  every script's scope is accounted for
 *   1  a script runs an excluded suite without declaring it, a declaration is
 *      stale, a script reaches Jest by a route that cannot be listed, or the
 *      local unit run reaches past the gated run
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';
import { cwd, exit, stderr, stdout } from 'node:process';

const PKG = 'package.json';

/** Absolute repo root. Selections come back absolute and are relativised to it. */
const ROOT_DIR = cwd();

/** The run CI gates on — the authority on which suites are unsafe. */
const GATED_SCRIPT = 'test:pipeline';

/** The local mirror of that run, which must not reach further than it does. */
const LOCAL_SCRIPT = 'test:unit';

/** How many escaping files to name before truncating the failure message. */
const SAMPLE_SIZE = 3;

/** Ceiling for a `--listTests` reply, comfortably above a few thousand paths. */
const LIST_BUFFER = 64 * 1024 * 1024;

/** Seconds to allow one listing before treating the script as unreadable. */
const LIST_TIMEOUT_MS = 120_000;

/** The Jest entry point a script must reach for its scope to be listable. */
const JEST_BIN = 'jest.js';

/**
 * Launchers that reach Jest without naming its entry point.
 *
 * These cannot have `--listTests` appended reliably — `npx` may install, `npm
 * exec` re-enters the script layer — so they are refused rather than guessed
 * at. Auditing a script against a scope it does not actually have is worse than
 * not auditing it, because the result reads like a pass.
 */
const INDIRECT_JEST = /(?:^|[\s|&;])(?:npx|yarn|pnpm|bunx|(?:npm|pnpm)\s+exec)\s+(?:--\s+)?jest\b/;

/** A script delegating to another npm script, capturing the target's name. */
const FORWARDING = /(?:^|[\s|&;])(?:npm|pnpm|yarn)\s+(?:--\S+\s+)*run\s+(\S+)/;

/** A script handing control to a local source file, capturing its path. */
const SOURCE_RUNNER =
  /(?:^|[\s|&;])(?:npx\s+tsx|tsx|ts-node|node)\s+(?:--\S+\s+)*(\S+\.(?:[cm]?ts|[cm]?js))/;

/**
 * This gate itself, which spawns Jest to ask what it selects.
 *
 * `SOURCE_RUNNER` would otherwise class `lint:jest-scopes` as a test entry
 * point that reaches Jest indirectly, which is true of the mechanism and false
 * of the intent: listing is not running, and this script selects no suites.
 */
const SELF = 'scripts/check-jest-scopes.mjs';

/**
 * Suites that must never run unattended, regardless of what any script says.
 *
 * The `test:unit` / `test:pipeline` comparison derives its baseline from the
 * gated run, which makes that run its own authority: delete an exclusion there
 * and the comparison keeps passing, because both sides widened together. This
 * list is the part of the baseline no script can move. Keep it to suites whose
 * danger is intrinsic rather than a matter of policy.
 */
const NEVER_UNATTENDED = ['src/Tests/E2e.test.ts'];

/**
 * A declaration pattern broad enough to excuse anything, which excuses nothing.
 *
 * `.*` or `.` would match every escaping path, so a declaration carrying one
 * would keep passing no matter how far the script drifted. Rejecting them keeps
 * a declaration a statement about particular suites.
 */
const CATCH_ALL = /^\^?\.[*+]?\$?$|^$/;

/**
 * Scripts that deliberately run suites `test:pipeline` excludes, and why.
 *
 * A script listed here must escape through exactly the paths named — every
 * escaping suite must match a declared pattern, and every declared pattern must
 * match a real escape. Add an entry only when running the excluded suites IS
 * the script's purpose; never to silence this gate for a script that merely
 * meant to narrow.
 */
const INTENTIONAL_ESCAPES = {
  test: {
    patterns: ['E2eMocked/', 'E2eReal/', 'src/Tests/E2e\\.test\\.ts$'],
    why: 'the bare entry point inherits only the base config, so it reaches the mocked E2E suites, the real-browser E2E suites and the live-bank factory suite — 38 suites beyond the gated run. This is why CLAUDE.md tells contributors to run test:unit instead',
  },
  'test:ci': {
    patterns: ['E2eMocked/', 'E2eReal/', 'src/Tests/E2e\\.test\\.ts$'],
    why: 'same scope as the bare entry point, with coverage — run only where live-bank credentials are expected',
  },
  'test:integration': {
    patterns: ['Tests/Integration/'],
    why: 'runs the integration suites serially — escaping that exclusion is the point',
  },
  'test:integration:mode-a': {
    patterns: ['Tests/Integration/'],
    why: 'mode-A slice of the serial integration run',
  },
  'test:integration:mode-a:bank': {
    patterns: ['Tests/Integration/'],
    why: 'per-bank mode-A slice of the serial integration run',
  },
  'test:integration:mode-b': {
    patterns: ['Tests/Integration/'],
    why: 'mode-B slice of the serial integration run',
  },
  'test:integration:mode-b:bank': {
    patterns: ['Tests/Integration/'],
    why: 'per-bank mode-B slice of the serial integration run',
  },
  'test:e2e:full': {
    patterns: ['E2eFull/'],
    why: 'the full-journey E2E suite the gated run hides from every other script',
  },
  'test:e2e:mock': {
    patterns: ['E2eMocked/'],
    why: 'the mocked E2E suite, excluded from the gated run because it is slow rather than unsafe',
  },
  'test:e2e:real:single': {
    patterns: ['E2eReal/'],
    why: 'drives a real browser against a live bank, one suite at a time, under supervision',
  },
  'test:e2e-factory-tests': {
    patterns: ['src/Tests/E2e\\.test\\.ts$'],
    why: 'the live-bank factory suite, which CI runs in its own job with credentials',
  },
};

/**
 * Scripts whose Jest command is built inside a source file rather than in
 * `package.json`, so `--listTests` cannot be appended to it.
 *
 * This is the one place the gate takes a declaration on trust instead of asking
 * Jest, so what it does and does not check is worth being blunt about. It holds
 * the script to still naming the file, and the file — when this checkout has it
 * — to still constructing a Jest command, which forces the declaration to be
 * revisited if the orchestrator is rewritten into something else.
 *
 * It does NOT check what an orchestrator selects. It cannot: the scope is
 * assembled inside the source file, and `memory:profile`'s `custom` mode takes
 * the pattern from whoever runs it, so there is no fixed answer to compare
 * against. A pattern list here would read as a constraint while enforcing
 * nothing, so the reachable suites are recorded in `why` as prose instead —
 * the gate should not appear to promise more than it verifies. Both scripts are
 * operator-run, never part of an unattended run, which is what makes an
 * unverified scope acceptable here and nowhere else.
 *
 * `run-real-suite.ts` is gitignored and so is absent from a fresh clone; see
 * `assertOrchestratorSource` for how that is told apart from a deletion.
 */
const ORCHESTRATORS = {
  'test:e2e:real': {
    source: 'scripts/run-real-suite.ts',
    why: 'builds a per-bank Jest command in TypeScript, reaching E2eReal/ suites, so its scope is not listable here',
  },
  'memory:profile': {
    source: 'scripts/memory-profile/profile-bank.mjs',
    why: 'assembles a Jest command per profiling mode, reaching E2eReal/ and E2eMocked/; its `custom` mode takes an operator-supplied pattern, so the scope is bounded by the operator rather than by this table — it is a supervised profiling tool, never part of an unattended run',
  },
};

/**
 * Abort the run. Drift is a build failure, never a warning: this defect is
 * already silent once, and a warning would make it silent twice.
 * @param {string} message - What escaped, and in which script.
 * @returns {never}
 */
function fail(message) {
  stderr.write(`check-jest-scopes: ${message}\n`);
  exit(1);
}

/**
 * Split a shell command line into tokens, honouring one level of quoting.
 *
 * Several scripts single-quote a `--testPathPatterns` regex, which `cmd.exe`
 * does not understand, so the tokens are handed to `spawn` directly rather than
 * through a platform shell. That also removes any chance of this gate executing
 * something a shell would have expanded.
 * @param {string} body - A raw npm script body.
 * @returns {string[][]} One token list per `&&`-, `||`- or `;`-separated command.
 */
function commandsOf(body) {
  const commands = [[]];
  let token = null;
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      token ??= '';
    } else if (/\s/.test(char)) {
      if (token !== null) commands.at(-1).push(token);
      token = null;
    } else if (isSeparator(body, i)) {
      if (token !== null) commands.at(-1).push(token);
      token = null;
      commands.push([]);
      if (body[i] === body[i + 1]) i += 1;
    } else token = (token ?? '') + char;
  }
  if (token !== null) commands.at(-1).push(token);
  return commands.filter((command) => command.length > 0);
}

/**
 * Whether the character at an index begins an unquoted command separator.
 * @param {string} body - The script body being tokenised.
 * @param {number} index - Offset of the candidate character.
 * @returns {boolean} True for `&&`, `||` or `;`.
 */
function isSeparator(body, index) {
  const char = body[index];
  if (char === ';') return true;
  return (char === '&' || char === '|') && body[index + 1] === char;
}

/**
 * Every command within a script that invokes Jest's entry point.
 *
 * `test:ci` copies a fixture file before running Jest, so the Jest call is not
 * necessarily the first command. All of them are collected rather than just the
 * first, because a script can chain a second Jest run after the one it appears
 * to be — `jest --config=safe.js && jest` reads as one audited call and runs two.
 * @param {string} body - A raw npm script body.
 * @returns {string[][]} Token lists for each Jest command, possibly empty.
 */
function jestCommandsOf(body) {
  return commandsOf(body).filter((command) => command.some((token) => token.endsWith(JEST_BIN)));
}

/**
 * Ask Jest which suites a command would run.
 *
 * `--listTests --json` resolves the whole selection — config, flags, aliases,
 * precedence — using the same code that would resolve it at run time, and
 * prints absolute paths without executing anything.
 * @param {string} script - Name of the script being audited, for diagnostics.
 * @param {string[]} tokens - The Jest command's tokens.
 * @returns {string[]} Repo-relative, slash-separated suite paths.
 */
function selectionOf(script, tokens) {
  const args = [...tokens.slice(1), '--listTests', '--json'];
  const run = spawnSync(tokens[0], args, {
    encoding: 'utf8',
    maxBuffer: LIST_BUFFER,
    timeout: LIST_TIMEOUT_MS,
    shell: false,
  });
  if (run.status !== 0) fail(listingFailure(script, run));
  return parseListing(script, run.stdout);
}

/**
 * Explain a failed listing without guessing at what the script would have run.
 * @param {string} script - Name of the script whose listing failed.
 * @param {import('node:child_process').SpawnSyncReturns<string>} run - The result.
 * @returns {string} A diagnostic naming the script and Jest's own complaint.
 */
function listingFailure(script, run) {
  const reason = (run.stderr || run.error?.message || '').trim().split('\n').slice(-3).join(' ');
  return `${script} could not be listed, so its scope is unknown: ${reason || 'no output'}. This gate asks Jest which suites a script selects; a script Jest refuses to resolve cannot be audited, and passing it silently would report a scope nobody verified.`;
}

/**
 * Read Jest's `--listTests --json` reply.
 * @param {string} script - Name of the script being audited, for diagnostics.
 * @param {string} out - Raw stdout from the listing run.
 * @returns {string[]} Repo-relative, slash-separated suite paths.
 */
function parseListing(script, out) {
  const start = out.indexOf('[');
  if (start < 0) fail(`${script} produced no test list; Jest printed: ${out.trim() || 'nothing'}`);
  return JSON.parse(out.slice(start, out.lastIndexOf(']') + 1)).map(toRepoPath);
}

/**
 * Normalise an absolute suite path to the repo-relative form used in messages.
 * @param {string} absolute - An absolute path as Jest reports it.
 * @returns {string} The path relative to the repo root, slash-separated.
 */
function toRepoPath(absolute) {
  return relative(ROOT_DIR, absolute).replaceAll('\\', '/');
}

/**
 * How a script reaches Jest, if it does.
 *
 * A script that reaches Jest by two routes at once is refused rather than
 * listed: `--listTests` can be appended to the direct call, but not to a
 * sibling `npx jest` or to a source file that builds its own command, so
 * listing only the readable half would report a narrower scope than the script
 * actually runs. Declaring it `unreadable` fails closed instead.
 * @param {string} name - The script's name.
 * @param {string} body - The script's body.
 * @param {Record<string, string>} scripts - Every script, for following `npm run`.
 * @returns {'direct'|'orchestrator'|'unreadable'|'none'} The route taken.
 */
function routeOf(name, body, scripts) {
  const hidden = INDIRECT_JEST.test(body) || reachesJestInSource(body);
  if (jestCommandsOf(body).length > 0) return hidden ? 'unreadable' : 'direct';
  if (name in ORCHESTRATORS) return 'orchestrator';
  if (hidden) return 'unreadable';
  return forwardsToJest(body, scripts) ? 'unreadable' : 'none';
}

/**
 * Whether a script hands control to a source file that spawns Jest itself.
 *
 * `test:e2e:real` is exactly this shape — `npx tsx scripts/run-real-suite.ts`,
 * which assembles a Jest command line and spawns it. Nothing in the script body
 * mentions Jest, so a gate reading only `package.json` would pass it without
 * ever seeing the scope it sets.
 * @param {string} body - The script's body.
 * @returns {boolean} True when the delegated file constructs a Jest command.
 */
function reachesJestInSource(body) {
  const file = SOURCE_RUNNER.exec(body)?.[1];
  if (!file || file === SELF || !existsSync(file)) return false;
  return readFileSync(file, 'utf8').includes(JEST_BIN);
}

/**
 * Whether a script delegates, directly or transitively, to a Jest-running one.
 *
 * The chain is followed to its end, not one step: `outer` -> `middle` -> a Jest
 * script must be refused as firmly as `outer` -> a Jest script. `seen` stops a
 * pair of scripts that forward to each other from recursing forever.
 * @param {string} body - The script's body.
 * @param {Record<string, string>} scripts - Every script, for following `npm run`.
 * @param {Set<string>} [seen] - Script names already visited on this chain.
 * @returns {boolean} True when the delegation chain ends at Jest.
 */
function forwardsToJest(body, scripts, seen = new Set()) {
  const target = FORWARDING.exec(body)?.[1];
  if (!target || seen.has(target) || !(target in scripts)) return false;
  seen.add(target);
  const targetBody = scripts[target];
  if (jestCommandsOf(targetBody).length > 0 || INDIRECT_JEST.test(targetBody)) return true;
  return reachesJestInSource(targetBody) || forwardsToJest(targetBody, scripts, seen);
}

/**
 * Refuse any script that reaches Jest by a route whose scope cannot be listed.
 * @param {Array<{name: string, body: string, route: string}>} scripts - Audited scripts.
 * @returns {void}
 */
function assertEveryRouteReadable(scripts) {
  const unreadable = scripts.find((script) => script.route === 'unreadable');
  if (!unreadable) return;
  fail(
    `${unreadable.name} reaches Jest by a route this gate cannot list: ${unreadable.body}. Its scope is decided somewhere this script cannot append \`--listTests\` — a launcher that re-enters the script layer, or a source file that builds the command itself — so a scope-changing flag arriving that way would be invisible here. Invoke Jest directly, or declare the script in ORCHESTRATORS with the reason its scope cannot be listed.`,
  );
}

/**
 * Hold every ORCHESTRATORS declaration to a real, still-Jest-running file.
 * @param {Record<string, string>} scripts - Every script in `package.json`.
 * @returns {void}
 */
function assertOrchestratorsIntact(scripts) {
  for (const [name, entry] of Object.entries(ORCHESTRATORS)) {
    if (!(name in scripts)) fail(staleDeclaration(name, 'ORCHESTRATORS', 'no such script exists'));
    if (!scripts[name].includes(entry.source)) {
      fail(staleDeclaration(name, 'ORCHESTRATORS', `it no longer runs ${entry.source}`));
    }
    assertReasonGiven('ORCHESTRATORS', name, entry.why);
    assertOrchestratorSource(name, entry.source);
  }
}

/**
 * Hold a declared orchestrator's file to still building a Jest command.
 *
 * The file can be legitimately absent: `scripts/**` is gitignored, and
 * `run-real-suite.ts` carries no negation, so it exists on the machine that
 * runs the real suite and nowhere else. Failing on that would block every
 * commit made from a fresh clone over a file the repo never had. Absence is
 * therefore only a failure when Git says the path is tracked, which is the one
 * case that means someone deleted it. The declaration is still held to the
 * script body naming the file, so it cannot rot unnoticed either way.
 * @param {string} name - The declared script.
 * @param {string} source - The file it delegates to.
 * @returns {void}
 */
function assertOrchestratorSource(name, source) {
  if (!existsSync(source)) {
    if (isTracked(source)) fail(staleDeclaration(name, 'ORCHESTRATORS', `${source} is gone`));
    return;
  }
  if (!readFileSync(source, 'utf8').includes(JEST_BIN)) {
    fail(staleDeclaration(name, 'ORCHESTRATORS', `${source} no longer builds a Jest command`));
  }
}

/**
 * Whether Git tracks a path, used only to tell a deletion from a gitignored file.
 *
 * A missing `git` answers "not tracked", which skips the content check rather
 * than blocking the commit. The stronger guard — the script body still naming
 * the file — does not depend on Git and always runs.
 * @param {string} path - Repo-relative path to test.
 * @returns {boolean} True when the path is in the index.
 */
function isTracked(path) {
  const args = ['ls-files', '--error-unmatch', '--', path];
  return spawnSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8' }).status === 0;
}

/**
 * Compose the message for a declaration that no longer describes reality.
 * @param {string} name - The declared script.
 * @param {string} table - Which table holds the declaration.
 * @param {string} reason - What no longer holds.
 * @returns {string} A diagnostic naming the entry and the drift.
 */
function staleDeclaration(name, table, reason) {
  return `${table} declares ${name}, but ${reason}. A declaration that has outlived what it described turns this gate into a rubber stamp for the next script that takes the same name, so remove the entry along with the thing it covered.`;
}

/**
 * Reject a declaration whose reason is blank.
 * @param {string} label - The table's name, for diagnostics.
 * @param {string} name - The declared script.
 * @param {string} why - The stated reason.
 * @returns {void}
 */
function assertReasonGiven(label, name, why) {
  if (!why?.trim()) {
    fail(`${label} declares ${name} without a reason. The reason is the whole value of the declaration: it is what tells the next reader whether the escape is still deliberate.`);
  }
}

/**
 * Reject declarations that cannot fail: a blank reason, or a catch-all pattern.
 * @param {Record<string, {patterns: string[], why: string}>} table - A declaration table.
 * @param {string} label - The table's name, for diagnostics.
 * @returns {void}
 */
function assertDeclarationsMeaningful(table, label) {
  for (const [name, entry] of Object.entries(table)) {
    assertReasonGiven(label, name, entry.why);
    const catchAll = entry.patterns.find((pattern) => CATCH_ALL.test(pattern));
    if (catchAll) {
      fail(`${label} declares ${name} with the catch-all pattern ${JSON.stringify(catchAll)}, which matches every path and therefore excuses every future drift. Name the paths the script is actually meant to reach.`);
    }
  }
}

/**
 * Whether any declared pattern matches a path.
 * @param {string[]} patterns - Declared path patterns, treated as regexes.
 * @param {string} file - A repo-relative suite path.
 * @returns {boolean} True when at least one pattern matches.
 */
function covers(patterns, file) {
  return patterns.some((pattern) => new RegExp(pattern).test(file));
}

/**
 * Name a few escaping files without flooding the failure message.
 * @param {string[]} files - Escaping suite paths.
 * @returns {string} A comma-separated sample, with a count of the remainder.
 */
function sample(files) {
  const shown = files.slice(0, SAMPLE_SIZE).join(', ');
  return files.length > SAMPLE_SIZE ? `${shown}, and ${files.length - SAMPLE_SIZE} more` : shown;
}

/**
 * Hold one script's escapes to exactly what it declares.
 * @param {string} name - The script's name.
 * @param {string[]} escapes - Suites it runs that the gated run excludes.
 * @returns {void}
 */
function auditEscapes(name, escapes) {
  const entry = INTENTIONAL_ESCAPES[name];
  if (!entry) return escapes.length > 0 && fail(undeclaredEscape(name, escapes));
  const beyond = escapes.filter((file) => !covers(entry.patterns, file));
  if (beyond.length > 0) fail(escapeBeyondDeclaration(name, beyond));
  const unused = entry.patterns.filter((pattern) => !escapes.some((f) => new RegExp(pattern).test(f)));
  if (unused.length > 0) fail(staleDeclaration(name, 'INTENTIONAL_ESCAPES', `it no longer reaches ${unused.join(', ')}`));
}

/**
 * Compose the message for an escape nobody declared.
 * @param {string} name - The script's name.
 * @param {string[]} escapes - The escaping suites.
 * @returns {string} A diagnostic naming the script and a sample of the suites.
 */
function undeclaredEscape(name, escapes) {
  return `${name} runs ${escapes.length} suite(s) that ${GATED_SCRIPT} excludes: ${sample(escapes)}. ${GATED_SCRIPT} is the run CI gates on, so its exclusions are this repo's definition of a suite that is not safe to run unattended. If reaching them is the point of this script, declare it in INTENTIONAL_ESCAPES with the paths it may reach and why; if it is not, narrow the script.`;
}

/**
 * Compose the message for a script that has drifted past its own declaration.
 * @param {string} name - The script's name.
 * @param {string[]} beyond - Suites outside the declared patterns.
 * @returns {string} A diagnostic naming the script and a sample of the suites.
 */
function escapeBeyondDeclaration(name, beyond) {
  return `${name} is declared in INTENTIONAL_ESCAPES, but now also runs ${beyond.length} suite(s) outside what it declares: ${sample(beyond)}. The declaration records which excluded suites this script is meant to reach; widening the script without widening the declaration is how the original defect got in.`;
}

/**
 * Refuse an INTENTIONAL_ESCAPES entry for a script that no longer escapes.
 * @param {Map<string, string[]>} escapesByScript - Escapes found per script.
 * @param {Record<string, string>} scripts - Every script in `package.json`.
 * @returns {void}
 */
function assertNoOrphanDeclarations(escapesByScript, scripts) {
  for (const name of Object.keys(INTENTIONAL_ESCAPES)) {
    if (!(name in scripts)) fail(staleDeclaration(name, 'INTENTIONAL_ESCAPES', 'no such script exists'));
    if ((escapesByScript.get(name) ?? []).length === 0) {
      fail(staleDeclaration(name, 'INTENTIONAL_ESCAPES', 'it no longer runs anything the gated run excludes'));
    }
  }
}

/**
 * Hold the immutable floor: suites that must not appear in an unattended run.
 *
 * Asserted against both runs independently, so weakening the gated run and the
 * local run together — which would keep the comparison between them passing —
 * still fails here.
 * @param {string} name - The script being checked.
 * @param {string[]} selected - The suites it selects.
 * @returns {void}
 */
function assertFloorHeld(name, selected) {
  const breach = NEVER_UNATTENDED.filter((file) => selected.includes(file));
  if (breach.length === 0) return;
  fail(
    `${name} runs ${breach.join(', ')}, which must never run unattended: it drives a real browser against a live bank. This is checked independently of the other scripts, so weakening two of them together does not make it pass. Restore the exclusion, or remove the suite from NEVER_UNATTENDED and say why in the same commit.`,
  );
}

/**
 * Hold the local unit run to the gated run's exclusions.
 * @param {string[]} escapes - Suites `test:unit` runs that the gated run excludes.
 * @returns {void}
 */
function assertLocalMirrorsGated(escapes) {
  if (escapes.length === 0) return;
  fail(
    `${LOCAL_SCRIPT} runs ${escapes.length} suite(s) that ${GATED_SCRIPT} deliberately excludes: ${sample(escapes)}. ${LOCAL_SCRIPT} is the local mirror of the gated run, so it must not reach what that run refuses. This is the exact defect the gate exists for: the suites still pass, so the only symptom is a slower run.`,
  );
}

/**
 * Audit every script in `package.json` and report.
 * @returns {void}
 */
function main() {
  const scripts = JSON.parse(readFileSync(PKG, 'utf8')).scripts ?? {};
  const audited = Object.entries(scripts).map(([name, body]) => ({
    name,
    body,
    route: routeOf(name, body, scripts),
  }));
  assertEveryRouteReadable(audited);
  assertOrchestratorsIntact(scripts);
  assertDeclarationsMeaningful(INTENTIONAL_ESCAPES, 'INTENTIONAL_ESCAPES');
  report(audit(audited, scripts));
}

/**
 * Ask Jest which suites a script would run, across every Jest call it makes.
 * @param {string} name - The script's name, for diagnostics.
 * @param {string} body - The script's body.
 * @returns {string[]} Every repo-relative suite path the script selects.
 */
function unionSelection(name, body) {
  const selected = new Set();
  for (const command of jestCommandsOf(body)) {
    for (const file of selectionOf(name, command)) selected.add(file);
  }
  return [...selected];
}

/**
 * List every direct script's selection and compare it with the gated run.
 * @param {Array<{name: string, body: string, route: string}>} audited - Audited scripts.
 * @param {Record<string, string>} scripts - Every script in `package.json`.
 * @returns {{direct: number, escapes: Map<string, string[]>}} The findings.
 */
function audit(audited, scripts) {
  const direct = audited.filter((script) => script.route === 'direct');
  const gated = unionSelection(GATED_SCRIPT, scripts[GATED_SCRIPT]);
  assertFloorHeld(GATED_SCRIPT, gated);
  const escapes = new Map();
  for (const script of direct) {
    const selected = unionSelection(script.name, script.body);
    if (script.name === LOCAL_SCRIPT) assertFloorHeld(LOCAL_SCRIPT, selected);
    escapes.set(
      script.name,
      selected.filter((file) => !gated.includes(file)),
    );
  }
  assertLocalMirrorsGated(escapes.get(LOCAL_SCRIPT) ?? []);
  for (const [name, found] of escapes) if (name !== GATED_SCRIPT) auditEscapes(name, found);
  assertNoOrphanDeclarations(escapes, scripts);
  return { direct: direct.length, escapes };
}

/**
 * Print what the audit covered, so a passing run still says what it checked.
 * @param {{direct: number, escapes: Map<string, string[]>}} findings - The audit result.
 * @returns {void}
 */
function report(findings) {
  const declared = Object.keys(INTENTIONAL_ESCAPES).length;
  const orchestrated = Object.keys(ORCHESTRATORS).length;
  stdout.write(
    `check-jest-scopes: ${findings.direct} jest scripts listed by Jest itself, ${declared} declared escapes, ${orchestrated} orchestrator(s) taken on trust, no silent ones, ${LOCAL_SCRIPT} runs nothing ${GATED_SCRIPT} excludes ✓\n`,
  );
}

main();
