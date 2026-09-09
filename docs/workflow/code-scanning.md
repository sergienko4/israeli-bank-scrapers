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
- name: Upgrade npm for Trusted Publishing
  # zizmor: ignore[adhoc-packages] — npm is the package manager itself, so it
  # cannot come from our own lockfile. Hardened instead: exact version pin,
  # `--ignore-scripts`, and `--audit-signatures`.
```

Prefer this over raising a global threshold: the exemption stays next to the
code it excuses, and the next finding of the same class still blocks.

## Standing finding 1: 28 Scorecard `PinnedDependenciesID` alerts — dismissed

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

No syntax satisfies both scanners:

| form               | GitHub            | zizmor                    | Scorecard          |
| ------------------ | ----------------- | ------------------------- | ------------------ |
| `$/…` (current)    | treated as pinned | **required**              | 28 false positives |
| `./…`              | not pinned        | `self-repository` finding | silent             |
| `owner/repo/…@sha` | pinned            | `self-repository` finding | silent             |

Reverting would buy a quiet scanner with a real security regression.

**Action:** dismiss as _false positive_, citing this page. Re-evaluate if
Scorecard adds `$/` support.

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
   dismiss.
4. **Scorecard `VulnerabilitiesID`?** Check the named GHSAs against the current
   lockfile first; the check is a weekly snapshot and is often already fixed —
   alert 63 named two browserslist advisories that `9ebcbc7` had already
   closed. It is one aggregate alert over all the OSV findings it lists, so it
   clears only when every one of them does. Note that it has never listed
   adm-zip, whose advisory bounds the range with `last_affected: 0.6.0` rather
   than a `fixed` version; if Scorecard's handling of that shape changes, this
   alert re-raises on something we cannot fix (standing finding 2).
5. Need a fresh Scorecard result now? `gh workflow run scorecard.yml`. The
   weekly cadence alone meant a dependency fixed on a Tuesday stayed reported
   until the following Monday.

[self-repo-blog]: https://github.blog/changelog/2026-07-30-reference-same-repository-actions-with-self-repository-syntax/
[adm-zip-advisory]: https://github.com/advisories/GHSA-vwc7-r8mq-g2x9
