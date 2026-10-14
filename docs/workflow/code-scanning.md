---
source-files:
  - osv-scanner.toml
  - .github/workflows/scorecard.yml
  - .github/workflows/workflow-security.yml
  - .github/scripts/ci/scorecard-npm-pins.sh
  - .github/scripts/ci/check-scorecard-npm-pins.mjs
  - scripts/filter-scorecard-sarif.mjs
  - package.json
  - package-lock.json
  - .github/dependabot.yml
  - renovate.json
  - .nvmrc
  - release-please-config.json
  - .github/scripts/ci/is-bot-pr.cjs
  - .github/scripts/ci/compute-gate-booleans.sh
  - .github/scripts/ci/detect-changes.sh
  - .github/actions/install-camoufox/action.yml
  - .github/actions/install-camoufox/install.sh
  - docker/Dockerfile.ci-mirror
  - .github/workflows/pr-body-check.yml
  - src/Tests/Unit/Pipeline/CrossValidation/DependabotSecurityGrouping.test.ts
  - src/Tests/Unit/Pipeline/CrossValidation/RenovateLockfileMaintenancePolicy.test.ts
  - .github/scripts/ci/docs-staleness-bot-skip.cjs
  - src/Tests/Unit/Pipeline/CrossValidation/DocsStalenessGate.test.ts
---

# Code scanning: two scanners, one authority

> **Who this is for:** maintainers triaging GitHub **Security → Code scanning**
> alerts, who need to know which scanner to believe when they disagree.

This repository uploads SARIF from three tools: **CodeQL**, **zizmor**, and
**OpenSSF Scorecard**. For anything concerning GitHub Actions, **zizmor is the
authority and Scorecard is advisory**. This page explains why, and records the
four standing findings that should not be "fixed" the obvious way.

## Why zizmor decides

|                  | zizmor                                                                       | Scorecard                        |
| ---------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| Scope            | purpose-built GitHub Actions auditor                                         | whole-project supply-chain score |
| Runs             | PRs touching `.github/workflows/**` or `.github/actions/**`, and every merge | weekly cron + on demand          |
| Blocking         | **yes** — `workflow-security.yml` fails on findings                          | no, SARIF only                   |
| Understands `$/` | yes                                                                          | **no**                           |

`workflow-security.yml` pins `zizmor==1.30.0` and now fails the job on findings.
That takes **two** invocations, which is worth understanding before editing the
workflow:

- `zizmor --format sarif … > zizmor.sarif` produces the file uploaded to code
  scanning. It **cannot** gate: zizmor documents that `--format sarif`
  disables its finding exit codes (11+), so this step returns 0 no matter what
  it finds. Verified against 1.30.0 on this tree — SARIF mode exited 0 while
  plain mode exited 12 on the same finding.
- `zizmor --format plain …`, after the upload, is the gate. Its exit code
  stands.

The job previously ran the SARIF invocation with `|| true`. Removing `|| true`
alone would have looked like a fix and changed nothing.

The version pin is deliberate too:

- **`>= 1.20.0`** — from that release, `unpinned-uses` requires hash-pinning on
  _every_ action by default, not only third-party ones.
- **`1.30.0`** — adds the `self-repository` audit, which is what validates our
  `$/` usage.

Nothing watches that pin automatically: Dependabot has no ecosystem for
`pipx install X==Y` inside a `run:` block. If it starts drifting badly, move to
the SHA-pinned `zizmorcore/zizmor-action` or a `requirements.txt`, either of
which Dependabot does track.

The `WSG-*` cases in `WorkflowSecurityGate.test.ts` pin all of this, because
every part can be removed by a well-meaning edit without anything else going
red — including the ones that live outside the `run:` block, like
`continue-on-error`, which GitHub Actions accepts at job level as well as step
level.

## Suppressing a zizmor finding

Because the gate has no `--min-severity` floor, _every_ finding blocks. Silence
one in the file it belongs to, with a reason, using the repository's existing
convention:

```yaml
on:
  # zizmor: ignore[dangerous-triggers] — no checkout of head code; see note above.
  pull_request_target:
```

Prefer this over raising a global threshold: the exemption stays next to the
code it excuses, and the next finding of the same class still blocks.

## npm installs: what Scorecard counts as pinned

Scorecard's `PinnedDependenciesID` reads every workflow `run:` block, shell
script and Dockerfile. It treats `npm install`, `npm i`, `npm install-test` and
`npm update` as unpinned downloads, **exact version or not** — `npm@11.11.0`
is still flagged. It accepts only two forms
([`shell_download_validate.go`][scorecard-npm]):

- `npm ci`, which installs what `package-lock.json` records and checks every
  tarball against its committed hash;
- a git URL (`github:`, `git+https:`, …) ending in `#<full commit hash>`.

Alerts #35 and #131 were both this rule; a comment in `release.yml` had
declared #35 closed on the strength of that exact pin. #35 was the publish job
upgrading npm for Trusted Publishing: the job now runs the latest Node 24
(`check-latest`, not whatever 24.x the runner has cached) — 24.5 and later
bundle npm 11.5.1+ — and fails closed on an older npm. #131 was the
consumer-install gate installing the packed tarball: it now installs the locked
production graph with `npm ci` and unpacks the tarball in place.

### The pull-request gate

The `npm commands are pinned as Scorecard reads them` step of the
`Static checks` job in `pr.yml` runs **the same engine** on every pull
request, so an unpinned npm command blocks the merge instead of surfacing as
an alert after the next scheduled scan. It does not re-implement Scorecard's
shell parser, so it sees exactly what the scan sees. The job checks out the
merge commit with no credentials, and the step runs
`.github/scripts/ci/scorecard-npm-pins.sh`, which:

1. reads the `ossf/scorecard-action` commit that `scorecard.yml` pins (every
   mention outside a comment line must be a plain `uses:` line, and together
   they must name one full commit SHA), fetches that commit's `go.mod`, and
   stops unless it embeds the Scorecard version the script pins
   (`SCORECARD_VERSION`), so a bump of the action cannot move the scan to
   another engine unnoticed. That check reads lines, so it cannot tell a step
   from text inside a `run: |` block; `ScorecardNpmPinGate.test.ts` parses the
   workflow as YAML and requires the fetched commit to be the one its action
   step runs. The action runs that engine from an image it names by tag
   (`ghcr.io/ossf/scorecard-action:v2.4.4`), not by digest; an upstream
   rebuild of that tag is beyond what the gate can check;
2. downloads that release's CLI and checks its SHA-256 **before** unpacking it;
3. scans a one-line `npm install` canary and requires the verdict to fail, so
   a gate that has gone blind cannot pass;
4. scans `git archive HEAD` — tracked files only, minus the symlinks and empty
   files Scorecard's archive mode skips — with `--checks=Pinned-Dependencies`;
5. passes the JSON to `check-scorecard-npm-pins.mjs`, which fails on any
   `npmCommand` warning, on `Possibly incomplete results`, on an inconclusive
   score, on a summary that counts no npm commands, and on any output shape it
   does not recognise.

Run it locally with `bash .github/scripts/ci/scorecard-npm-pins.sh`. It needs
`curl`, `tar`, `git`, `node` and `sha256sum` or `shasum`, runs on Linux or macOS (amd64 or arm64), uses
no token, and scans the committed `HEAD`, not the working tree.
`ScorecardNpmPinGate.test.ts` pins the wiring: the step can block a merge,
cannot swallow its own failure, verifies the download before unpacking it, and
runs the canary before the real scan.

**Bumping the engine.** When Dependabot moves `ossf/scorecard-action` to a
commit that embeds another Scorecard version, the gate fails with
`does not embed Scorecard v…`. Move `SCORECARD_VERSION` and the four SHA-256s
in the script (from the release's `scorecard_checksums.txt`) and the
`v5.5.0` constants in `ScorecardNpmPinGate.test.ts` and
`CheckScorecardNpmPins.test.ts` in the same pull request. If the new engine
changes its JSON, regenerate the fixtures under
`src/Tests/Unit/Tools/Fixtures/ScorecardNpmPins/` from real output.

**What neither the gate nor the scan can see.** These limits belong to the
engine, so they apply to the scheduled scan too:

- **Steps on a shell Scorecard skips.** It parses a `run:` only when the
  step's `shell:` — or failing that, the job's `defaults.run.shell` — is a
  single word naming `bash`, `sh` or `mksh` (`/bin/bash` and `BASH` count).
  With arguments (`bash -e {0}`), `pwsh`, or no shell on a Windows runner or
  under a Windows-only `if:`, it skips the step without a word. It ignores workflow-level `defaults` and goes
  by the runner instead. `WorkflowShellPolicy.test.ts` keeps every workflow
  step scannable, and is deliberately stricter: a step or job shell must be
  exactly `bash` or `sh`, a workflow-level default must start with one, and a
  step with no shell needs a literal, non-Windows `runs-on` and an `if:` that
  does not mention Windows.
- **Composite actions.** Scorecard does not scan the `action.yml` files under
  `.github/actions/`, at any depth. The same test holds their steps to
  `bash`/`sh`, but review npm commands there by hand (today they use only
  `npm ci`, `npm run` and `npx`).
- **Parser errors Scorecard does not report.** A script it fails to parse
  without emitting `Possibly incomplete results` passes silently.
- **Commands assembled at runtime** (`eval`, variables).

## Standing finding 1: 28 Scorecard `PinnedDependenciesID` alerts — filtered from the SARIF

**Do not "fix" these by changing `uses:` syntax.**

Scorecard v2.4.4 does not understand GitHub's
[`$/` self-repository syntax][self-repo-blog] (shipped July 2026) and reports
each use as a third-party action lacking a hash pin. Every genuine third-party
action in this repository _is_ pinned to a 40-character SHA, and none of those
is flagged.

The alerts were caused by adopting the syntax, not by a regression:

| date                       | event                                 | alerts raised             |
| -------------------------- | ------------------------------------- | ------------------------- |
| 2026-08-17 / 08-24 / 08-31 | scans while still on `./`             | 0                         |
| 2026-09-01                 | `f8a48d1` (#548) migrates `./` → `$/` | —                         |
| 2026-09-07                 | first scan afterwards                 | **all 28, one timestamp** |

The flagged syntax is the _more_ secure one. Per zizmor's `self-repository`
audit, `$/` "is not subject to runtime filesystem state, meaning that it can't
load an action that was cloned at runtime in a previous step", and "is treated
as a form of pinning" by GitHub — which `./` is not.

No single _syntax_ satisfies both scanners at once:

| form               | GitHub            | zizmor                          | Scorecard          |
| ------------------ | ----------------- | ------------------------------- | ------------------ |
| `$/…` (current)    | treated as pinned | **required**                    | 28 false positives |
| `./…`              | not pinned        | `self-repository` finding, High | silent             |
| `owner/repo/…@sha` | pinned            | passes (no `self-repository`)   | silent             |

The `owner/repo/…@sha` row was verified empirically against zizmor 1.30.0
(exit 0, no `self-repository` finding), correcting an earlier claim here that
zizmor objected to it. It is still rejected on other grounds: it hard-codes
`sergienko4`, so it breaks on forks (the reason `$/` was adopted), and pinning
a self-reference by SHA means every edit to a composite action needs the pin
bumped at every call site. Reverting `$/` therefore buys a quiet scanner for a
real regression, whichever alternative form is chosen.

**What we do instead — satisfy both scanners without touching `$/`.** The
false positives only exist in the SARIF that `scorecard.yml` uploads to code
scanning; `publish_results` (the public scorecard.dev score) is a separate
channel. So the workflow runs
[`scripts/filter-scorecard-sarif.mjs`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/scripts/filter-scorecard-sarif.mjs)
between `ossf/scorecard-action` and `github/codeql-action/upload-sarif`. It
drops only the `PinnedDependenciesID` results whose flagged source line is a
`uses: $/…` self-repository reference. A genuinely unpinned third-party action
never matches `$/`, so it survives the filter and is still reported — the
security property is preserved. zizmor stays green because `$/` is untouched,
and code scanning stays clean because the false positives never arrive.

The filter runs in its own `analysis` job, never in the `scorecard` job.
With `publish_results: true`, the scorecard.dev API rejects any run whose
Scorecard job holds a step other than an
[approved `uses:` action][scorecard-restrictions]. The first version of this
filter ran as a `run:` step inside the Scorecard job and failed every scheduled
scan from 2026-09-14 on. No SARIF reached code scanning, so alert 63 stayed open
on advisories that `main` had already fixed. `scorecard` now only produces the
SARIF and hands it over as an artifact. `analysis` downloads it, filters
it and uploads it. The downloaded copy belongs to the runner user, while the
original is written as root by the Scorecard container and cannot be
rewritten in place.

The upload job keeps the key `analysis` on purpose.
`github/codeql-action/upload-sarif` files every
upload under `<workflow path>:<job key>`, and the existing Scorecard alerts
belong to `.github/workflows/scorecard.yml:analysis`. An upload under a new key
starts a new configuration. The old one goes stale, and its alerts stay open
until it is [deleted by hand][stale-config].

The wiring and the surgical scope are pinned by tests in
`WorkflowSecurityGate.test.ts`. `SCF-*` assert the filter runs in
`analysis` after the download and before the upload, and that `scorecard`
never uploads the unfiltered SARIF. `SCI-1` asserts the upload keeps the
`scorecard.yml:analysis` key. `SCP-*` assert `scorecard` keeps to the
approved actions and is the only holder of `id-token: write`, the workflow
root included, and that the root grants no write permission at all. `FSS-*` in
`FilterScorecardSarif.test.ts` assert a real unpinned third-party action is
kept while `$/` hits are dropped.

**Action:** the 28 open alerts clear as _fixed_ on the next Scorecard run on
`main` after this ships (the filtered SARIF no longer references those lines).
Trigger one on demand with `gh workflow run scorecard.yml`. Re-evaluate — and
remove the filter — if Scorecard adds `$/` support: upstream tracking issue
[ossf/scorecard#5191][scorecard-5191] is still open.

## Standing finding 2: adm-zip — patched here, accepted risk for consumers

[`GHSA-vwc7-r8mq-g2x9`][adm-zip-advisory] — extraction follows destination
symlinks, allowing arbitrary file overwrite. CWE-59, moderate — CVSS v3.1 6.5,
v4.0 6.8 — affecting `>=0.5.9 <=0.6.0`. The advisory lists no patched version.

**Our lockfile is patched.** adm-zip 0.6.1 (2026-09-11) is outside the range,
and its release notes block extraction from writing through symlinks. The root
`overrides` entry `"adm-zip": "^0.6.1"` forces the lock's single adm-zip entry
to 0.6.1, although `@hieutran094/camoufox-js` itself still declares `^0.5.16`.

**Consumers are not.** npm applies `overrides` only from the root project, so
an app installing this package resolves camoufox-js's own `^0.5.16` — today
0.5.18, inside the range. The residual-risk reasoning below is for them.

We never import adm-zip. It arrives under `@hieutran094/camoufox-js`, and only
half of its call sites are even the vulnerable shape:

| call site                                         | pattern                      | writes to disk     | vulnerable |
| ------------------------------------------------- | ---------------------------- | ------------------ | ---------- |
| `generative-bayesian-network` (read)              | `getEntries()` / `getData()` | no — in memory     | no         |
| `generative-bayesian-network` (write)             | `addFile` / `writeZip`       | creates an archive | no         |
| `camoufox-js` `extractAllTo(dir, true)`           | extraction, overwrite on     | yes                | **yes**    |
| `camoufox-js` `extractEntryTo(e, p, false, true)` | extraction, overwrite on     | yes                | **yes**    |

Residual risk for consumers is low for two independent reasons:

1. An attacker must pre-plant a symlink inside `~/.cache/camoufox`. Anyone who
   can write there already holds the user's permissions.
2. The archive is a `daijro/camoufox` GitHub release fetched over HTTPS, not
   attacker-supplied input.

Our own CI relies on the override at launch, not at install. Every
`install-camoufox` call follows `setup-node-deps` (`npm ci`) and runs
`.github/actions/install-camoufox/install.sh`, which also builds the Docker CI
mirror. The script works in the directory camoufox-js launches from:
`CAMOUFOX_INSTALL_DIR` when set, else `~/.cache/camoufox`. A cache hit, meaning
the pinned `version.json` plus a non-empty executable regular-file
`camoufox-bin`, skips extraction. On a cache miss it first refuses, before
any download, to replace a directory that is relative, is `$HOME`, or holds
anything but a Camoufox install (a `camoufox-bin` entry or a tag-shaped
`version.json`), so a mistyped override cannot erase unrelated files. It then
downloads the release asset of the tag pinned in `browser-stack.json` and
checks it against `camoufox.linuxX64Sha256`, the SHA-256 pinned beside the
tag. A mismatch fails before the directory is touched. Only then does it clear
the directory and extract the asset with system `unzip`. It never runs
`camoufox-js fetch`, which would resolve
camoufox-js's own newest release instead of the pin. It writes `version.json`
last, so a failed extract is never recorded as installed. CI downloads the
exact asset with `gh release download`; the Docker build has no token and uses
`curl` on the public release URL, so the image carries no GitHub CLI. At launch, camoufox-js downloads its default
uBlock Origin addon into that directory when it is missing and extracts it with
`extractEntryTo`, which runs on the locked adm-zip 0.6.1. A manifest edit is a
browser-stack change: the detector arms `critical_deps`, so the pull request
runs the full suite.

**Action:** keep the override until camoufox-js declares `>=0.6.1` itself, then
drop it. Watch the advisory: it bounds the range by `last_affected`, so a
widened range would re-cover 0.6.1. Consumers can add the same `overrides`
entry, or on shared or multi-user hosts set `CAMOUFOX_INSTALL_DIR` to a private
directory.

## Standing finding 3: braces — accepted risk, no fix exists

[`GHSA-vfj7-8cjw-p6xm`][braces-advisory] — deeply nested brace patterns
exhaust the stack (uncontrolled recursion, denial of service). CWE-674, high —
CVSS v3.1 7.5, v4.0 8.7 — affecting `<=3.0.3`.

**The latest published braces is 3.0.3 — inside the affected range.** There is
no version to upgrade to and nothing for an `overrides` entry to point at.

We never import braces. It is a dev-only dependency, reached through exactly
one chain: `eslint-plugin-check-file` → `micromatch` → `braces`.

| call site                                   | pattern source                       | matched against | runtime |
| ------------------------------------------- | ------------------------------------ | --------------- | ------- |
| `check-file/filename-naming-convention`     | literal globs in `eslint.config.mjs` | repo file paths | no      |
| `check-file/folder-naming-convention`       | literal globs in `eslint.config.mjs` | repo dir paths  | no      |
| `check-file/folder-match-with-fex`          | literal globs in `eslint.config.mjs` | repo file paths | no      |
| plugin naming presets (`PASCAL_CASE`, etc.) | constants inside the plugin          | path segments   | no      |

Residual risk is negligible for three independent reasons:

1. The only patterns that reach braces are written by maintainers, such as
   `'src/**/*.{ts,tsx}'`. Nothing user-supplied or network-supplied is ever
   expanded.
2. The worst outcome is a crashed lint run on a developer machine or in CI —
   no data exposure and no persistent effect.
3. braces is not in `lib/`, not in the published tarball, and not in any
   runtime dependency, so consumers of the package never install it.

**Action:** accepted, and suppressed for Scorecard in the root
`osv-scanner.toml` with `ignoreUntil = 2027-04-03`, so the ignore expires and
forces a fresh look. Re-evaluate sooner if braces publishes above 3.0.3 or
`eslint-plugin-check-file` drops micromatch. After the file lands on `main`,
run `gh workflow run scorecard.yml` to clear the alert.

## Standing finding 4: dev-scoped transitive alerts were auto-dismissed

**A fixable transitive advisory stayed open for weeks because GitHub's
auto-triage dismissed its Dependabot alert, and an open alert is the only thing
that makes Dependabot target an npm transitive.** The obvious fix — hand-editing
`package-lock.json` — clears today's alert and leaves the gap for the next one.

[`GHSA-jggr-w7fw-pc2j`][fast-copy-advisory] — fast-copy recurses without a
depth limit and exhausts the stack on deeply nested values. CWE-674, medium —
CVSS v4.0 6.3 — fixed in 4.1.0. The lockfile held 4.0.3, reached through one
dev-only chain: `pino-pretty` (a root `devDependency`) → `fast-copy`.

The cause chain:

1. The repository-level preset rule "Dismiss low impact issues for
   development-scoped dependencies" was enabled.
2. Dependabot alert 52 (fast-copy, scope `development`, transitive) was set to
   `auto_dismissed`.
3. A dismissed alert gets no Dependabot security pull request.
4. Version updates target direct dependencies only. None of them re-resolved
   fast-copy, so the lockfile stayed at 4.0.3.
5. Scorecard's OSV scan reads the lockfile on `main`, so code-scanning alert 63
   kept listing the advisory.

| Dependabot path  | targets an npm transitive?                                   | runs when                                   |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------- |
| version updates  | **no** — direct only; npm has no `dependency-type: indirect` | the weekly schedule in `dependabot.yml`     |
| security updates | yes — a lockfile-only bump to the first patched version      | an alert is **open** and a fix is published |

**Action:** disable that preset rule and leave it off (Settings → Advanced
Security → Dependabot rules). The `npm-security` group in `.github/dependabot.yml` puts
every npm security update into one pull request. That pull request still needs
code-owner approval, like any other. The group uses the pattern `'*'`, so one
bump that fails CI holds back the rest. To unblock it, open a separate pull
request that bumps the failing package. Once that merges, Dependabot rebases
the group without it ([GitHub's recovery steps][grouped-security-errors]). Do
not narrow the group instead.
`src/Tests/Unit/Pipeline/CrossValidation/DependabotSecurityGrouping.test.ts`
fails if the group is removed, renamed, or narrowed (`exclude-patterns`,
`dependency-type`, `update-types`). It also fails if another npm group is
scoped to anything but version updates. Only a missing `applies-to` defaults
to version updates; a key with an empty value fails.

Turning the rule off is not documented to reopen alerts it already dismissed.
If alert 52 still reads `auto_dismissed`, reopen it (Security → Dependabot →
the alert → Reopen) so Dependabot can raise the pull request. Reopen only an
alert that has a patched version; without one there is nothing to bump.

**Limit:** Dependabot never targets a transitive that has no open alert. It
moves only when a direct-dependency bump happens to re-resolve it. A second
lane covers the rest: [Renovate lockfile maintenance][renovate-lfm], configured
in `renovate.json` with every other update type disabled, so it never
competes with Dependabot. The first `packageRules` entry disables every
package by name (`"*"`), so an update type Renovate adds later stays off too.
Lockfile maintenance has no package name, so that rule never matches it.

- Once a week (Friday, 00:00–05:59 Asia/Jerusalem) it regenerates the whole
  `package-lock.json` within the ranges in `package.json`. It opens at most one
  pull request, `chore(deps): lock file maintenance`, and only when the
  lockfile changes.
- `minimumReleaseAge: "3 days"` is not a guaranteed cooldown here. Renovate's
  [minimum release age guide][renovate-mra] lists lockfile maintenance as
  unsupported, because npm, not Renovate, picks the new versions. For npm,
  Renovate passes a `--before` cutoff three days back. If npm fails with
  `ETARGET`, for example because a locked package is newer than the cutoff,
  Renovate retries without `--before` and logs a warning. A version published
  in the last three days can therefore still land in the pull request.
- Friday only keeps this run apart from Dependabot's Monday run. It does not
  guarantee any package age. No automerge, code-owner review, the full unit
  and mocked E2E run, and keeping bank secrets out limit what a fresh release
  can reach before a human approves it. None of them enforces an age.
- `constraints.npm` pins npm 10.9.2, the version bundled with the Node release
  in `.nvmrc` that CI installs, so the lockfile format matches `npm ci`. The
  detector flags a `.nvmrc` change as `deps` too, so a Node bump on its own
  still runs the unit legs and `lint:node-support` (CoverageLegGate CLG-5).
- Dependabot security pull requests take precedence. When one merges first and
  the lockfiles conflict, Renovate regenerates its branch on its next run
  (`rebaseWhen` defaults to rebasing a conflicted branch).
- The pull request is authored by `renovate[bot]`. `is-bot-pr.cjs` exempts it
  from the PR-body gates and the docs-staleness check, and
  `compute-gate-booleans.sh` keeps it off the
  real-bank gates, so bank secrets never reach freshly installed package code.
  The unit and mocked E2E suites still run (`deps` covers the lockfile).
- It is never auto-merged: it needs code-owner approval like any other pull
  request. `chore` is a hidden changelog type in `release-please-config.json`.
- The [Renovate app][renovate-app] must run this repository in Interactive
  mode; in Silent mode it opens no pull requests.

To roll back: switch the app to Silent (or uninstall it), close the open pull
request and delete its `renovate/lock-file-maintenance` branch, then revert the
commit that added `renovate.json`. Confirm no onboarding pull request appears.

`src/Tests/Unit/Pipeline/CrossValidation/RenovateLockfileMaintenancePolicy.test.ts`
fails if `renovate.json` enables another update type, if `packageRules`
drifts from the exact catch-all and update-type pair, if the cooldown or the
schedule is dropped, if automerge is turned on, or if either bot exemption
drifts. It also pins the wiring in `pr.yml`. The workflow must run on every
pull request to `main`, with no path filter. The detector must flag
`package-lock.json` as `deps`, and the `changes` job must export that flag.
The `changes` job and its detector and gate steps must carry no `if:` or
`continue-on-error:`. The gate step must receive the PR author.
`real_gates_enabled` must reach `validate`. The unit, mocked E2E and
`package-factory` jobs must need only `changes` and run whenever `deps` is
set. Inside `package-factory`, the factory E2E step keeps its own `deps` term
(PackageFactoryJob PFJ-4). Conditions
are compared after unwrapping `${{ }}` and every layer of outer parentheses.
In `pr-body-check.yml`, a newer push or body edit of the same pull request
cancels the run it supersedes, so the check reports the latest body
(WorkflowConcurrencyGate pins the key). Each gate is found by its step id
(`section-check`, `stage-body`). It must require `is-bot-pr.cjs` once, at the
top level, and return on `isBotPr(pr)` before it fails the check or stages
the body. Before
the guard, each gate declares exactly its own `const` bindings, none missing,
repeated or extra, each with its exact initializer: `fs` from
`require('node:fs')` (`stage-body` only), `isBotPr` from the workspace
`is-bot-pr.cjs` require, and `pr` from `context.payload.pull_request`. For a
bot pull request, the guard only calls `core.info` (in `stage-body`, then
exactly `core.setOutput('skip', 'true')`), then a bare `return`. The
`core.setOutput` calls are pinned too: `section-check` sets none, and
`stage-body` sets `skip` to `true` only inside the guard and to `false` once,
at the top level, after staging the body. The statements after the
`stage-body` guard are pinned verbatim (stage `pr.body || ''`, then set
`skip` to `false`), so the staged body cannot be blanked or the skip flipped
back. Neither gate step, nor the `body-check` job, may set `if:` or
`continue-on-error:`. The cited-path check is found by its exact `run`
command. It must appear once, run only when `skip` is not `true`, and set no
`continue-on-error:`. This is an exact syntactic check of the inline script,
not a semantic proof. It does not defend against deliberate obfuscation,
which code-owner review covers. The test also checks that there
is exactly one `chore` changelog section and that it stays hidden, so
lockfile commits stay out of release notes. `pr.yml`
changes too often to bind to this page, so the test guards it instead. When
the pre-commit quality gates run, the docs-staleness hook flags this page if a
bound file changes. The docs staleness step of the `Static checks` job in
`pr.yml` runs the same check
on every pull request that `is-bot-pr.cjs` does not exempt. Bot pull requests
are exempt through that predicate: Dependabot action bumps and release-please
version bumps routinely touch bound files, and a bot cannot update this page.
The predicate also exempts any same-repository branch named `dependabot/…` or
`release-please--…`, so a person with write access can exempt a hand-written
pull request by naming its branch that way. Three controls narrow the gap. The
Scorecard npm-pin gate fails a `scorecard-action` bump that changes the
embedded Scorecard engine until a person moves its pin. The pre-commit hook
runs on a human commit pushed to a bot branch only when that commit stages
source code; it skips commits that touch only `.github/`, `.husky/`, Markdown,
JSON or YAML files, which covers most files bound to this page. The guard
tests still run on bot pull requests that touch CI scripts or dependencies.
Two gaps remain, and each needs a person to update the page: a bot bump that
keeps the same engine, such as a change to the `scorecard-action` image tag
quoted above, and a human commit on a bot branch that touches only non-code
bound files. The job decides the exemption in a plain `node` step that runs
`docs-staleness-bot-skip.cjs`. It does not use `actions/github-script`, which
would hand the job's token to code loaded from the pull request's checkout. The
script reads the event payload and fails the job if the payload carries no pull
request, rather than skipping the scan.
`DocsStalenessGate.test.ts` pins the job's wiring. It pins each of the job's
three steps whole, the checkout action to any full commit SHA, and pins the
bot script's code and the `validate` aggregator step line for line. It
requires the workflow's strict `bash` shell with no job `defaults:` or step
`shell:` override, so a decoy step, an early `exit 0` or a lax shell cannot
quietly turn the gate off. It fixes the job's own fields, which keeps it on a
GitHub-hosted `ubuntu-latest` runner with no `container:` or `services:`. It
limits the `env:` keys the workflow and the job declare to a fixed allowlist,
so a preload declared there, such as `BASH_ENV` or `NODE_OPTIONS`, cannot run
code ahead of the pinned steps.

Verify after a change:

```bash
gh api repos/sergienko4/israeli-bank-scrapers/dependabot/alerts/52 --jq .state
gh pr list --author app/dependabot --search fast-copy --state all
npm ls fast-copy
gh workflow run scorecard.yml
gh run list --workflow scorecard.yml --limit 1 # copy the new run's id
gh run watch <run-id> --exit-status
gh api repos/sergienko4/israeli-bank-scrapers/code-scanning/alerts/63 --jq .state
```

The Dependabot alert should be `open` with a Dependabot pull request listed,
or `fixed` once that pull request merges. `npm ls` should show 4.1.0 or later.
Read alert 63 only after the Scorecard run finishes — SARIF processing can lag
a few minutes more — and expect `fixed`.

## Triage checklist

1. **zizmor finding?** Real. It blocks; fix it, or suppress it in-file with a
   reason (above). The failing job's plain-text log is the readable "why" —
   zizmor's `low` findings map to SARIF `level: note`, which the Security →
   Code scanning default view de-emphasises. Note also that the scan runs
   offline (no token is mapped in), so zizmor's online-only audits, such as
   `known-vulnerable-actions`, are skipped.
2. **CodeQL finding?** Real until proven otherwise.
3. **Scorecard `PinnedDependenciesID` on a `$/` line?** Standing finding 1 —
   should no longer reach you: `scripts/filter-scorecard-sarif.mjs` strips it
   from the SARIF before upload. If one appears anyway, the filter is broken
   (its line no longer matched `uses: $/…`, or the step was reordered after the
   upload) — fix the filter, do not dismiss the alert.
4. **Scorecard `PinnedDependenciesID` on an `npm` line?** Real. Replace the
   command with `npm ci` from a lockfile (see "npm installs" above) — an exact
   version does not clear it. The Scorecard npm-pin pull-request gate runs
   the same engine and should have caught it first; if it did not, check
   whether the engine pins have drifted, or the line sits in one of the blind
   spots listed under "The pull-request gate".
5. **Scorecard `VulnerabilitiesID`?** Check the named GHSAs against the current
   lockfile first; the check is a weekly snapshot and is often already fixed —
   an earlier snapshot of alert 63 named two browserslist advisories that
   `9ebcbc7` had already closed. It is one aggregate alert over all the OSV
   findings it lists, so it clears only when every one of them does. If a GHSA
   still reproduces against the lockfile but no Dependabot pull request exists,
   open the matching Dependabot alert: `auto_dismissed` means an auto-triage
   rule closed it, as happened with fast-copy
   [`GHSA-jggr-w7fw-pc2j`][fast-copy-advisory] (standing finding 4). braces is
   suppressed through `osv-scanner.toml` (standing finding 3). Any new entry
   there needs a matching standing finding on this page, a `reason`, and an
   `ignoreUntil` date. Note that the alert has never listed adm-zip, whose
   advisory bounds the range with `last_affected: 0.6.0` rather than a `fixed`
   version; the lockfile now holds 0.6.1, outside that range. If it is ever
   raised, check that the override still holds, which adm-zip entries the lock
   carries, whether the advisory range widened, and how the scanner reads
   `last_affected` (standing finding 2).
6. Need a fresh Scorecard result now? `gh workflow run scorecard.yml`. The
   weekly cadence alone meant a dependency fixed on a Tuesday stayed reported
   until the following Monday.
7. **Scorecard run failed?** Every alert it owns freezes at the last
   successful snapshot until a run succeeds again. Read the log first. A
   `workflow verification failed` warning means the `scorecard` job holds a
   step the scorecard.dev API does not accept (`SCP-1` should have caught it).

[self-repo-blog]: https://github.blog/changelog/2026-07-30-reference-same-repository-actions-with-self-repository-syntax/
[scorecard-5191]: https://github.com/ossf/scorecard/issues/5191
[scorecard-npm]: https://github.com/ossf/scorecard/blob/main/checks/raw/shell_download_validate.go
[scorecard-restrictions]: https://github.com/ossf/scorecard-action#workflow-restrictions
[stale-config]: https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/resolve-alerts#removing-stale-configurations-and-alerts-from-a-branch
[adm-zip-advisory]: https://github.com/advisories/GHSA-vwc7-r8mq-g2x9
[braces-advisory]: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
[fast-copy-advisory]: https://github.com/advisories/GHSA-jggr-w7fw-pc2j
[grouped-security-errors]: https://docs.github.com/en/code-security/reference/supply-chain-security/troubleshoot-dependabot/dependabot-errors#failed-to-update-dependency-in-grouped-pull-request
[renovate-lfm]: https://docs.renovatebot.com/configuration-options/#lockfilemaintenance
[renovate-mra]: https://docs.renovatebot.com/key-concepts/minimum-release-age/
[renovate-app]: https://github.com/apps/renovate
