# Code scanning: two scanners, one authority

> **Who this is for:** maintainers triaging GitHub **Security → Code scanning**
> alerts, who need to know which scanner to believe when they disagree.

This repository uploads SARIF from three tools: **CodeQL**, **zizmor**, and
**OpenSSF Scorecard**. For anything concerning GitHub Actions, **zizmor is the
authority and Scorecard is advisory**. This page explains why, and records the
two standing findings that should not be "fixed".

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

`ScorecardNpmPinGate.test.ts` holds the line, and is stricter than the
scanner: across every tracked workflow, shell script (by extension or shebang,
so the husky hooks count) and Dockerfile it accepts **only** `npm ci` — not
`npm install ci` or a commit-pinned git URL, both of which Scorecard lets
through. Like Scorecard, it also reads `sh -c` bodies (whatever shell options
come first, such as `--noprofile` or `-o pipefail`), command substitutions,
exec-form `RUN` lines in either case, and each workflow `run:` as YAML decodes
it, so a folded scalar is one command. Past a wrapper such as `sudo -u root`,
`/usr/bin/env -u CI` or `timeout 600` it keeps looking for `npm`. It is a
line-based heuristic, not Scorecard's shell parser: it reads heredoc bodies as
ordinary lines, and cannot follow commands assembled at runtime (`eval`,
variables).

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
   version does not clear it — and `ScorecardNpmPinGate.test.ts` should have
   caught it first.
5. **Scorecard `VulnerabilitiesID`?** Check the named GHSAs against the current
   lockfile first; the check is a weekly snapshot and is often already fixed —
   alert 63 named two browserslist advisories that `9ebcbc7` had already
   closed. It is one aggregate alert over all the OSV findings it lists, so it
   clears only when every one of them does. Note that it has never listed
   adm-zip, whose advisory bounds the range with `last_affected: 0.6.0` rather
   than a `fixed` version; if Scorecard's handling of that shape changes, this
   alert re-raises on something we cannot fix (standing finding 2).
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
