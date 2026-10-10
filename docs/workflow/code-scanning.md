---
source-files:
  - osv-scanner.toml
---

# Code scanning: two scanners, one authority

> **Who this is for:** maintainers triaging GitHub **Security → Code scanning**
> alerts, who need to know which scanner to believe when they disagree.

This repository uploads SARIF from three tools: **CodeQL**, **zizmor**, and
**OpenSSF Scorecard**. For anything concerning GitHub Actions, **zizmor is the
authority and Scorecard is advisory**. This page explains why, and records the
three standing findings that should not be "fixed".

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

The `scorecard-npm-pins` job in `pr.yml` runs **the same engine** on every pull
request, so an unpinned npm command blocks the merge instead of surfacing as
an alert after the next scheduled scan. It does not re-implement Scorecard's
shell parser, so it sees exactly what the scan sees. The job checks out the
merge commit with no credentials and runs
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
`ScorecardNpmPinGate.test.ts` pins the wiring: the job can block a merge,
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

## Standing finding 2: adm-zip — accepted risk, no fix exists

[`GHSA-vwc7-r8mq-g2x9`][adm-zip-advisory] — extraction follows destination
symlinks, allowing arbitrary file overwrite. CWE-59, moderate — CVSS v3.1 6.5,
v4.0 6.8 — affecting `>=0.5.9 <=0.6.0`.

**The latest published adm-zip is 0.6.0 — inside the affected range.** There is
no version to upgrade to and nothing for an `overrides` entry to point at.

We never import adm-zip. It arrives under `@hieutran094/camoufox-js`, and only
half of its call sites are even the vulnerable shape:

| call site                                         | pattern                      | writes to disk     | vulnerable |
| ------------------------------------------------- | ---------------------------- | ------------------ | ---------- |
| `generative-bayesian-network` (read)              | `getEntries()` / `getData()` | no — in memory     | no         |
| `generative-bayesian-network` (write)             | `addFile` / `writeZip`       | creates an archive | no         |
| `camoufox-js` `extractAllTo(dir, true)`           | extraction, overwrite on     | yes                | **yes**    |
| `camoufox-js` `extractEntryTo(e, p, false, true)` | extraction, overwrite on     | yes                | **yes**    |

Residual risk is low for three independent reasons:

1. An attacker must pre-plant a symlink inside `~/.cache/camoufox`. Anyone who
   can write there already holds the user's permissions.
2. The archive is a `daijro/camoufox` GitHub release fetched over HTTPS, not
   attacker-supplied input.
3. CI mostly avoids the path: `install-camoufox` prefers `gh release download`
   plus system `unzip`, and clears the directory first.

**Action:** accepted. Re-evaluate when adm-zip publishes above 0.6.0. Consumers
on shared or multi-user hosts can set `CAMOUFOX_INSTALL_DIR` to a private
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
   version does not clear it. The `scorecard-npm-pins` pull-request job runs
   the same engine and should have caught it first; if it did not, check
   whether the engine pins have drifted, or the line sits in one of the blind
   spots listed under "The pull-request gate".
5. **Scorecard `VulnerabilitiesID`?** Check the named GHSAs against the current
   lockfile first; the check is a weekly snapshot and is often already fixed —
   an earlier snapshot of alert 63 named two browserslist advisories that
   `9ebcbc7` had already closed. It is one aggregate alert over all the OSV
   findings it lists, so it clears only when every one of them does. braces is
   suppressed through `osv-scanner.toml` (standing finding 3). Any new entry
   there needs a matching standing finding on this page, a `reason`, and an
   `ignoreUntil` date. Note that the alert has never listed adm-zip, whose
   advisory bounds the range with `last_affected: 0.6.0` rather than a `fixed`
   version; if Scorecard's handling of that shape changes, this alert re-raises
   on something we cannot fix (standing finding 2).
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
