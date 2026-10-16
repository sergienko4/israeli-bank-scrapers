---
title: Browser stack
source-files:
  - .github/dependabot.yml
  - .github/workflows/browser-stack-watch.yml
  - browser-stack.json
  - scripts/browser-stack-watch.mjs
  - scripts/browser-stack/camoufox-releases.mjs
  - scripts/browser-stack/fetch-protocol.mjs
  - scripts/browser-stack/gen-config.mjs
  - scripts/browser-stack/playwright-versions.mjs
  - scripts/browser-stack/watch-report.mjs
  - scripts/browser-stack/watch.mjs
  - src/Scrapers/Pipeline/Mediator/Browser/BrowserStackConfig.ts
  - src/Scrapers/Pipeline/Mediator/Browser/BrowserStackCheck.ts
  - src/Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.ts
  - scripts/browser-stack/manifest.mjs
  - scripts/browser-stack/gate.mjs
  - scripts/browser-stack/gate-report.mjs
  - tsup.config.ts
  - src/Tests/Unit/Tools/BrowserStackGenConfig.test.ts
  - src/Tests/Unit/BundleImportAttributesPolicy.test.ts
  - src/Tests/Unit/Pipeline/Mediator/Browser/BrowserStackPlaywrightReader.test.ts
---

# Browser stack — the tested Camoufox × playwright-core pair

> **Who this is for:** anyone upgrading Camoufox or `playwright-core`, or
> reading a `browser stack differs from the tested pair` warning in a log.

The scraper drives a Camoufox (Firefox) build through `playwright-core`. Both
sides speak the Juggler protocol, so they only work together in pairs that
were tested together. Each release is tested against one Camoufox tag and one
`playwright-core` minor. That pair is declared once and read everywhere else.

## One source, one generated module

[`browser-stack.json`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/browser-stack.json)
holds the pair: `camoufox.tag` and `playwrightCore.testedMinor`, plus the
protocol deltas the CI gate accepts for it. CI installs the Camoufox tag from
it, and the gate checks `playwright-core` against it. A delta can be accepted
because the `postinstall` patch removes it on the client side, as it does for
1.64's `bypassServiceWorker`; a unit test then fails if the patched copy still
sends it. See
[The 1.64 patches](../workflow/browser-stack-upgrade.md#the-164-patches).

Runtime code cannot read a repository JSON file from the published package,
so `npm run browser-stack:gen` renders the pair into
[`BrowserStackConfig.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Browser/BrowserStackConfig.ts),
which exports `TESTED_CAMOUFOX_TAG` and `TESTED_PLAYWRIGHT_MINOR`. A stale
module is replaced by renaming a complete new file over it, so if writing or
renaming that file fails, the old module stays intact rather than truncated.
Never edit it by hand. A unit test fails when it is not the render of the manifest, and
the CI gate reports `GENERATED-STALE`. See the Browser stack row in
[CI gates](../workflow/ci.md).

The module lives under `Pipeline/Mediator/Browser`, beside its only reader,
because Pipeline code may not import from `src/Common`.

## The runtime check

`launchCamoufox` calls `checkBrowserStack()` after the bounded launch returns
a browser. The check runs once per process and compares the installed
versions with the tested pair:

| Component | Installed version read from | Counts as tested when |
|---|---|---|
| `camoufox` | camoufox-js's cache record, `<version>-<release>` | It equals the tag without its leading `v` |
| `playwright-core` | the `package.json` of the copy camoufox-js resolves | Its `major.minor` equals the tested minor |

camoufox-js takes `playwright-core` as a peer and imports it from its own
location, and that copy drives the browser. The dependency tree can hold more
than one copy, so the copy beside this package is not necessarily the one
camoufox-js loads. `readPlaywrightVersion(anchor)` therefore finds
camoufox-js from the anchor first, then `playwright-core` from camoufox-js's
real path. Each package directory is looked up along Node's own search paths
(`require.resolve.paths`) rather than resolved: an `exports` map that hides
`./package.json`, which a later camoufox-js release may add, would make
resolving the manifest fail, and Jest's config maps camoufox-js's bare name to
a mock. The real path keeps symlinked layouts, such as pnpm's, reading the
copy beside camoufox-js's real directory. The default reader anchors at its
own module; tests anchor at temp trees with nested, hoisted, conflicting,
`exports`-restricted and symlinked copies.

Each component that differs is logged once at `warn` level, with
`{ component, installed, tested, remedy }`. A different version may still
work, so the check never fails a launch. It never rejects. A reader that
throws, as the Camoufox reader does before the first download, skips its
component with a `debug` line that carries only the redacted message length.
A logger that throws also only skips its component. `launchCamoufox` guards
the call as well and bounds it by `STACK_CHECK_DEADLINE_MS` (2 s), so a check
that ever rejected or never settled would still not cost the caller its
launched browser. The deadline is a timer, so it bounds only asynchronous
waiting: it cannot interrupt the readers' synchronous reads of the Camoufox
version file and the two package manifests. A file system that stalls during
them blocks the event loop and the deadline with it, as it would block
camoufox-js's own synchronous reads of the same install at launch.
The consumer-facing guide is in
[Troubleshooting](../troubleshooting.md#browser-stack-differs-from-the-tested-pair).

The check runs after the launch bound, not inside it, for three reasons:

- Its reads are not charged against `CAMOUFOX_LAUNCH_TIMEOUT_MS`.
- A launch that is abandoned at the bound never triggers it.
- The bound's disposal logic stays free of awaited I/O.

`createBrowserStackCheck(readers)` builds an independent check. Production
uses `DEFAULT_STACK_READERS`, and tests inject their own `IStackReaders`. A
check is a `BrowserStackCheck` that resolves to a `WarningCount`: 0, 1 or 2
on the first call, and 0 after it.

## The weekly watch

Two things move upstream without a PR here: the `playwright-core` version a
consumer's `^` range resolves to, and the Camoufox release camoufox-js
downloads. Every Monday at 06:00 UTC,
`.github/workflows/browser-stack-watch.yml` runs
`scripts/browser-stack-watch.mjs` to report what the gate says about them.

The watch reads two upstream sources:

- **Camoufox releases.** It reads the page camoufox-js reads: the first page
  of `daijro/camoufox` releases, 30 by default. It picks the release
  camoufox-js would install by the same rule: the first one that is neither a
  prerelease nor a draft and has an asset for the runner's platform, judged by
  camoufox-js's own asset check. That check is the one in the camoufox-js the
  lockfile installs. A newer camoufox-js in the library's `^` range reaches a
  fresh consumer install first; Dependabot opens it as its own `camoufox`
  group PR, which CI tests, and the watch judges with it once that PR lands.
- **The `playwright-core` packument.** It takes the version a consumer's
  install resolves from the library's own `dependencies['playwright-core']`
  range in `package.json`, picked the way npm picks it: npm `latest` when it
  satisfies the range, else the highest stable version that does. A
  prerelease is never picked. Only a caret range `^X.Y.Z` is supported; any
  other form exits 2 with `RANGE-UNSUPPORTED`.

It runs the gate once, in `candidate` mode with `--json`, on that version ×
the selected release: the consumer pair. It judges no
other pair. The Dependabot PR's own `Browser stack contract` job judges the
lockfile pair, and a prerelease or a later minor is for the PR that lands it.
The report is written well inside the job's 15-minute limit even when every
`Protocol.js` fetch times out on every attempt, or when the newest Camoufox
layout answers 404 only on its last attempt and the older one then times out.
The report has two sections:

| Section | What it says |
|---|---|
| Consumer pair | The version the range resolves to × the selected release, and the gate's verdict: compatible; not compatible, with its NEW protocol paths; or unknown, with the gate's errors, when it could not decide. With no stable version in range, it says so. With no selected release, a consumer's Camoufox install fails. |
| CI drift | Whether the tag in `browser-stack.json` is the selected release. |

Compatible only means the Juggler protocols match within the accepted
deltas. It does not make a pair landable: that still takes a PR that pins
the pair and passes CI.

The workflow keeps the report as the body of one open issue labelled
`browser-stack` that the workflow opened. Each run edits that body and never
comments, and an issue that a person labels keeps its body. The job holds
`contents: read` and `issues: write` only. A manual run is a dry run unless
`dry_run` is cleared: it prints the report to the log and the job summary and
leaves the issue alone. When the watch cannot read its inputs (the manifest,
the `playwright-core` range in `package.json`, the releases page or the
packument) it exits 2, the job fails, and the issue keeps the previous report.
A body that is not JSON, a packument whose `latest` tag is not in its version
map, or a releases page whose releases or assets lack a field camoufox-js reads
counts as unreadable: reading it anyway would report a missing version or
release that upstream never removed.
`BrowserStackWatch.test.ts` pins the report, `BrowserStackWatchBounds.test.ts`
the time bound, and `BrowserStackWatchWiring.test.ts` the workflow.

To run it locally, use `node scripts/browser-stack-watch.mjs [--out <file>]`;
a `GITHUB_TOKEN` in the environment raises the GitHub API rate limit.

## Why the readers avoid JSON imports

`tsup.config.ts` enables `treeshake`, which sends every chunk through Rollup.
Rollup rewrites import attributes to the `assert` keyword, which Node 22
rejects. So `import(..., { with: { type: 'json' } })` passes every
source-level test and then fails in the published package alone. The
`playwright-core` reader therefore uses `createRequire`, anchored at
`import.meta.url` in production, which works in both bundles because Rollup
shims `import.meta.url` in CommonJS.
`BundleImportAttributesPolicy.test.ts` fails if any bundled source file uses
import attributes.
