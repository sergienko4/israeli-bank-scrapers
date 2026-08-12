# Doc path gate

`npm run lint:doc-paths` asserts that every repo-relative path cited in the
agent-facing docs actually exists.

## Why this gate exists

`CLAUDE.md` is loaded by every agent session as the canonical rule source.
When `src/` was restructured — `src/helpers/` → `src/Common/`,
`src/scrapers/` → `src/Scrapers/` — **all seven** entries in its "Key Files"
list silently rotted. Nothing caught it:

- The paths are inline code spans, not Markdown links, so no link checker
  looks at them.
- [`check-docs-links.sh`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/.github/scripts/ci/check-docs-links.sh)
  only resolves published site URLs.
- `mkdocs build --strict` only validates links *inside* `docs/`.

The cost is not cosmetic. An agent that trusts a phantom path spends a whole
investigation on a file that is not there, and can reach a confidently wrong
conclusion. This gate was written after exactly that happened.

## What it checks

For each file it scans, every inline-code token shaped like a repo-relative
path (contains `/`, ends in an extension) must resolve on disk.

Deliberately **not** checked:

| Skipped | Why |
| --- | --- |
| Markdown link labels — ``[`Banks/X.ts`](url)`` | `docs/` shortens the label relative to a documented base while the link target carries the full path. Treating the label as repo-relative reports drift that is not there. |
| Bare prose tokens without a `/` or extension | Too many ordinary words look like paths; the false-positive rate would make the gate noise. |
| Root-level files — `package.json`, `CLAUDE.md` | No `/`, so they do not match the path shape. They are also the least likely citations to rot. |
| Globs — `src/**/*.ts`, `scripts/*.mjs` | No single path to resolve. Expanding them would need a matcher and would turn an empty match into a failure the author cannot act on. |
| Paths inside fenced code blocks | Command examples cite files that do not exist yet, or exist only on another machine. Gating them would fight the docs. |
| Citations split across a line break | The scanner reads one line at a time. A wrapped span is skipped rather than reported as a truncated phantom. |
| Paths that escape the repository — `../../etc/passwd` | The CI job scans contributor-controlled PR-body text. Probing them would report through the exit status whether a file outside the repo exists. Citations are repo-relative by definition, so refusing to traverse upward costs nothing. |
| `node_modules/`, `http(s)://`, `.git/` | Installed, remote, or ephemeral — never committed. |
| `.github/PR_BODY.md` | A run-time handoff file the pre-push hook *searches for*. Documenting it is correct even when absent; gating it would pass locally and fail in CI. |

A trailing locator is stripped rather than skipped: `src/Common/Browser.ts:17`
and `src/Common/Browser.ts#L17` both resolve to the file. Both forms appear in
agent docs, and dropping the suffix is cheaper than losing the coverage. The
suffix itself is not verified — a citation may name a line that has since moved.

These gaps are deliberate. Closing them needs a real Markdown parser, and each
would trade a class of silent rot for a class of false positives — which is the
failure mode that gets a gate switched off.

## Scope

Gated files are listed in the `lint:doc-paths` script in `package.json`:
`README.md`, `CLAUDE.md`, `CLEAN_CODE.md`, `CONTRIBUTING.md`, and
`.github/copilot-instructions.md` — the docs that address agents and use
repo-root-relative paths by convention.

The `docs/` tree is **not** gated. It uses base-relative citations in prose
(for example `Banks/Amex/scrape/AmexShape.ts`, relative to
`src/Scrapers/Pipeline/`), which are more readable in a table and are already
backed by a full link target. Converting that convention would be a large
change unrelated to the drift this gate prevents.

### Why `docs/` stays ungated — measured

That exclusion was an assumption until it was measured. Running the checker
across all 70 files under `docs/` reported **56 unresolved citations**.
Classifying each by whether any tracked file *ends with* the cited token:

| Class                                                          | Count | Verdict                         |
| -------------------------------------------------------------- | ----- | ------------------------------- |
| Base-relative shorthand (exactly one suffix match)             | 37    | Legitimate — the convention     |
| External planning/session files outside the repo               | 5     | Legitimate — not repo paths     |
| Prose ellipsis — a filename abbreviated with `...` in a table  | 3     | Not a path at all               |
| ESM specifier `.js` resolving to a `.ts` source                | 2     | Legitimate — TypeScript ESM     |
| A removed path the prose explicitly describes as removed       | 2     | Legitimate — deliberate         |
| Planned files the prose itself says were never created         | 2     | Legitimate — hypothetical       |
| A path that existed and was later deleted                      | 1     | Legitimate — historical record  |
| A legacy module named approximately in a historical row        | 1     | Stale, but self-evidently past  |
| **Named as existing test suites, but never created**           | **3** | **Real drift — fixed here**     |

So **53 of 56 are correct**, and gating `docs/` as-is would report 53 false
positives to surface 3 real ones — the exact trade the "Known gaps" section
above refuses, because a gate that cries wolf gets switched off.

The 3 real ones sat in `docs/phase-7-consolidation-map.md`, a historical
record of a shipped phase, and are corrected in place. Note what found them:
not this gate, but a knowledge-graph re-analysis. Closing the remaining gap
needs base-awareness — a per-file "paths here are relative to X" declaration —
not a wider glob. Until something declares that base, `docs/` stays out of
scope by evidence rather than by assumption.

Reproduce (expect 53 after this change, all classified above as legitimate):

```bash
node scripts/check-doc-paths.mjs $(git ls-files 'docs/**/*.md')
```

## PR bodies

The same checker runs against the PR body, where a stale path is equally
misleading. Two entry points:

- **CI** — the `Validate PR body sections` job in
  [`pr-body-check.yml`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/.github/workflows/pr-body-check.yml).
  Bot PRs are exempt: generated changelogs cite paths from across history,
  including files since moved. The exemption trusts a branch prefix only for
  same-repo PRs — otherwise any fork contributor could opt out by naming a
  branch `dependabot/x`.
- **Local** — the pre-push hook, when it finds a PR body file.

`--diff-base <ref>` additionally accepts paths the diff *removes*, so a body may
legitimately describe a file it deletes or renames away. The hook defaults to
`origin/main`; set `PR_BODY_DIFF_BASE` to override it when the PR targets
another branch. If the ref is not present locally the hook skips the flag and
says so, rather than failing on a citation it cannot classify.

## Running it

```bash
npm run lint:doc-paths                                     # gated docs
node scripts/check-doc-paths.mjs path/to/file.md           # any file
node scripts/check-doc-paths.mjs --diff-base origin/main .git/PR_BODY.md
```

Exit codes: `0` all cited paths resolve, `1` at least one does not, `2` usage
error.

## When it fails

```text
CLAUDE.md: 9 cited, 1 unresolved
  ✗ src/scrapers/errors.ts
```

Update the citation to the current location — do not delete the entry. If the
file genuinely moved, that is the gate doing its job; find the new home (the
LSP `workspaceSymbol` operation is the fastest way) and fix the reference.

## Known limitation

This verifies that cited paths **resolve**. It cannot judge whether the
surrounding prose is true. A PR body describing an abandoned approach while
citing valid paths passes this gate — that class of drift is caught by review,
not by tooling.
