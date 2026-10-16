---
source-files:
  - browser-stack.json
  - scripts/check-browser-stack.mjs
  - scripts/browser-stack/gate.mjs
  - scripts/browser-stack/gate-report.mjs
  - scripts/browser-stack/manifest.mjs
  - .github/actions/install-camoufox/install.sh
  - src/Scrapers/Pipeline/Mediator/Browser/BrowserStackCheck.ts
  - scripts/patch-playwright-core.mjs
  - scripts/browser-stack/playwright-versions.mjs
  - scripts/browser-stack/gen-config.mjs
  - src/Tests/E2eMocked/BrowserStackContract.e2e-mocked.test.ts
  - .github/workflows/pr.yml
---

# Upgrading the browser stack

> **Who this is for:** maintainers landing a new Camoufox build or
> `playwright-core` minor, or deciding what to do with a Dependabot
> `playwright-core` PR that fails the `Browser stack contract` job.

Camoufox and `playwright-core` move as one pair. Change the pair in
`browser-stack.json`, prove it with the gate, the runtime contract and a
packed-consumer smoke, and land it in one PR.
[Browser stack](../architecture/browser-stack.md) explains the parts; this
page is the procedure.

## The gate and its two modes

`npm run lint:browser-stack` runs `scripts/check-browser-stack.mjs`. It fetches
the Juggler protocol of `playwright-core` (from the lockfile, or
`--playwright <x.y.z>`) and of Camoufox (`camoufox.tag`, or
`--camoufox <tag>`), diffs them, and subtracts the deltas the manifest
accepts. `--json` prints the report as one JSON line instead.

| Finding           | Meaning                                                                | `--mode gate` (PR CI) | `--mode candidate` |
| ----------------- | ---------------------------------------------------------------------- | --------------------- | ------------------ |
| `NEW`             | A delta the manifest does not accept                                   | fails                 | fails              |
| `STALE`           | An accepted delta that is no longer found                              | fails                 | `[info]`           |
| `DRIFT`           | The `playwright-core` minor is not `testedMinor`                       | fails                 | `[info]`           |
| `GENERATED-STALE` | `BrowserStackConfig.ts` is not what `npm run browser-stack:gen` writes | fails                 | `[info]`           |

Exit 0 passes, exit 1 means a finding fails the mode, and exit 2 means the
gate could not decide: `USAGE`, `MANIFEST-INVALID`, `LOCKFILE-INVALID`,
`FETCH-FAILED` or `UNPARSEABLE`. Fix the input or rerun; an exit 2 never
justifies accepting a delta.

## Reading the output

This is `node scripts/check-browser-stack.mjs --playwright 1.64.0` against a
manifest that pins Camoufox `v156.0.1-beta.36` and tests 1.63:

```text
browser-stack: playwright-core 1.64.0 × Camoufox v156.0.1-beta.36 (mode=gate)
  client sha256=5a39c410…  browser sha256=d7bad1be…
NEW       request UNKNOWN-FIELD          Network.setRequestInterception.bypassServiceWorker  src:Optional(Boolean)|dst:absent
DRIFT     playwright-core minor 1.64 ≠ testedMinor 1.63 (bump testedMinor only after the contract test passes)
ACCEPTED  request TYPE-MISMATCH          Browser.setHTTPCredentials.credentials
ACCEPTED  request MISSING-METHOD         Browser.setScreencastOptions
FAIL: 1 new, 0 stale, 2 accepted, drift
```

Each delta row reads status, channel, kind, path and signature:

- **Channel** is the direction. On `request` the client sends params that the
  browser validates strictly. On `return` and `event` the browser sends and
  the client reads only the fields it knows.
- **Path** is the method or event, then the field.
- **Signature** is `src:<type>|dst:<type>`: the type on the side that
  produces the message, then the type on the side that consumes it. On
  `request`, `src` is the client (`playwright-core`'s params) and `dst` the
  browser (Camoufox). On `return` and `event`, `src` is the browser and `dst`
  the client. `absent` means that side has no such field, method or event.

The two `sha256` values identify the protocol files that were compared, so two
runs can be checked against each other.

## Accepting a delta

Accept a `NEW` delta only with evidence that it does not break this library,
and with any consumer-visible effect written up. Copy the row into
`acceptedDeltas` in `browser-stack.json`:

```json
{
  "channel": "request",
  "kind": "TYPE-MISMATCH",
  "path": "Browser.setHTTPCredentials.credentials",
  "signature": "src:Array(Object)|dst:{origin,password,username}",
  "reason": "Sent only when a context uses httpCredentials, which src never does (0 in src). A consumer passing newContext({ httpCredentials }) gets a Juggler protocol error on this pair."
}
```

- `channel`, `kind`, `path` and `signature` are the delta's identity. Copy
  them from the row exactly; a different signature is a different delta.
- `reason` (10 to 240 characters) states the evidence, such as a count of
  uses in `src` or the fact that the client never sends the call.
- A delta that reaches consumers also needs a `compatibility.json` entry. The
  `httpCredentials` delta above has one.

The manifest validator rejects a missing or extra key and a duplicate
identity. CODEOWNERS makes the maintainer the reviewer of every change, and
that review signs off each new reason. Remove a `STALE` delta in the same PR:
either upstream fixed it, or its signature changed and it is reported as `NEW`
as well.

## Compatible and landable

- **Compatible:** `--mode candidate` exits 0. The two protocols match within
  the accepted deltas.
- **Landable:** compatible, the tag is the release camoufox-js installs for a
  consumer today, and the pair passes everything in
  [Upgrading the pair](#upgrading-the-pair).

The [weekly watch](../architecture/browser-stack.md#the-weekly-watch) reports
the first for the consumer pair, whose tag is that release by construction.
Only a PR proves the second: a protocol match says nothing about behaviour,
which is what the contract and the smoke test.

## Upgrading the pair

Start when the weekly watch reports the consumer pair compatible: the
`playwright-core` version that this library's `^` range in `package.json`
resolves to (npm `latest` when it is in range, else the highest stable version
in range), against the release camoufox-js selects. A compatible prerelease is
not enough.

In one PR, either the Dependabot PR rebased with your commits or a PR that
supersedes it:

1. Set `camoufox.tag` to the selected release and `playwrightCore.testedMinor`
   to the minor of the consumer pair's version. The lockfile must resolve that
   minor.
2. Run `npm run browser-stack:gen` to rewrite `BrowserStackConfig.ts`.
3. Run `node scripts/patch-playwright-core.mjs --strict`. A `GUARD-SITES` or
   `SHIM-SITES` line means the new minor moved a patched call; review and
   update the patcher before going on.
4. Run `npm run lint:browser-stack` until it exits 0, removing `STALE` deltas
   and accepting `NEW` ones only as described above.
5. Run the runtime contract against the new Camoufox:
   `npm run test:e2e:mock -- --runTestsByPath src/Tests/E2eMocked/BrowserStackContract.e2e-mocked.test.ts`.
   Its invariants come from Playwright's documented API and never change per
   pair: C1 `page.route` and C2 `context.route` fulfil a request, and C3 and C4
   keep each `Set-Cookie` as its own entry in `headersArray()` and
   `headerValues()` and in the cookie jar. CI runs the same file as the first
   step of the Mock E2E job.
6. Add a `compatibility.json` entry and run `npm run compat:build`.
7. Run the packed-consumer smoke below.
8. Push. Full CI must pass, and a maintainer runs the E2E-real smoke.

### Packed-consumer smoke

CI tests the repository with its lockfile. A consumer installs the tarball and
gets whatever its ranges resolve to, plus the Camoufox release camoufox-js
selects. The smoke installs the packed library the way a consumer does.

Run it in a container built from `docker/Dockerfile.ci-mirror`, because
`camoufox-js fetch` replaces the Camoufox cache it finds. Save this probe as
`probe.mjs`:

```js
import http from 'node:http';
import { Camoufox } from '@hieutran094/camoufox-js';

const server = http.createServer((req, res) => {
  res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
  res.end('origin');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await Camoufox({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.route('**/routed', route => route.fulfill({ status: 200, body: 'routed' }));
const routed = await page.goto(`${base}routed`);
console.log('C1 page.route fulfils:', (await routed.text()) === 'routed');
const response = await page.goto(base);
console.log('C4 Set-Cookie entries:', (await response.headerValues('set-cookie')).length);
console.log(
  'C4 cookie jar:',
  (await context.cookies())
    .map(c => c.name)
    .sort()
    .join(','),
);
await browser.close();
server.close();
```

Then pack the library and pipe the tarball into a fresh consumer:

```bash
docker build -f docker/Dockerfile.ci-mirror -t isbs-ci:latest .
npm pack --pack-destination /tmp/pack
docker run --rm -i -e PROBE="$(cat probe.mjs)" --entrypoint bash isbs-ci:latest -c '
  set -e
  cat > /tmp/pkg.tgz
  mkdir /tmp/consumer && cd /tmp/consumer
  npm init -y > /dev/null
  npm install --no-audit --no-fund /tmp/pkg.tgz > /dev/null
  rm -rf "$HOME/.cache/camoufox"
  npx camoufox-js fetch > /dev/null
  cat "$HOME/.cache/camoufox/version.json"; echo
  npm ls playwright-core
  printf "%s\n" "$PROBE" > probe.mjs
  node probe.mjs' < /tmp/pack/sergienko4-israeli-bank-scrapers-<version>.tgz
```

The image bakes in the pinned build, so the script deletes it first and lets
camoufox-js fetch the release it selects. The smoke passes when all of these
hold:

- `version.json` reads as `camoufox.tag` without its `v`: a version of
  `156.0.1` and a release of `beta.36` match `v156.0.1-beta.36`.
- Every `playwright-core` copy `npm ls` lists has the `testedMinor` minor.
- The probe prints `true`, `2` and `a,b`.

## The routing shim

`playwright-core` 1.64 sends `bypassServiceWorker` when it turns on request
interception, and no released Camoufox accepts it. The `postinstall` patch
rewrites that call to the 1.63 form, so `page.route()` works for a consumer
who resolves 1.64. The gate diffs the protocol schemas, not the calls a
patched client sends, so it still reports the field as `NEW` for 1.64. The
shim does not change how 1.64 reports multi-value `Set-Cookie`, so it does not
make 1.64 landable. See
[`Protocol error (Network.setRequestInterception)`](../troubleshooting.md#protocol-error-networksetrequestinterception)
for the consumer side.

## Rollback

Revert the upgrade PR. That restores `browser-stack.json`, the generated
module and the lockfile together. CI's Camoufox cache key follows the tag, so
the next run installs the previous build again. If the pair already shipped in
a release, keep its compatibility entry and add one for the rollback.

A consumer who cannot wait for a release can pin `playwright-core` to the
tested minor with an `overrides` entry, as
[Troubleshooting](../troubleshooting.md#browser-stack-differs-from-the-tested-pair)
describes.
