# Mode B HAR-replay simulator — skeleton (Step 3a)

This directory holds the **operator-independent skeleton** of the
Phase 11 Mode B simulator: pure data structures and pure functions
that read Playwright `recordHar` output and convert it into rows the
existing [`MirrorSimulator`](../Mirror/MirrorSimulator.ts) can consume.

## What is committed today

| File                     | Purpose                                                        | Lines / fn cap |
| ------------------------ | -------------------------------------------------------------- | -------------- |
| `HarTypes.ts`            | HAR 1.2 type subset (no runtime code)                          | n/a            |
| `HarLoader.ts`           | Read + validate Playwright-recorded HAR JSON                   | 10/10          |
| `StatefulRewriter.ts`    | Sequence-aware `(method, canonical URL, hit#) → entry` matcher | 10/10          |
| `HarToMirrorManifest.ts` | Project HAR entries → manifest rows (no FS IO)                 | 10/10          |

All four are **fully unit-tested** with synthetic HAR JSON. They do
not touch the network, the filesystem (except `HarLoader.readFileSync`),
or Playwright. They are safe to ship before any real bank recording
exists.

## What is intentionally **deferred** (and why)

The Step 3 spec at
`C:\tmp\plans\israeli-bank-scrapers-fork\phase-11-full-coverage\status.md`
originally listed six modules. The rubber-duck review during the Step 3
design pass surfaced three blocking issues:

1. **`HttpServer.ts` + `ProxyConfig.ts` with HTTPS cert generation**
   was high-complexity and required either a new dependency
   (`selfsigned`, `node-forge`, `pem`) or hand-rolled X.509 generation.
   It also conflated origin-server semantics with forward-proxy
   semantics. **Deferred** until a concrete failure case shows that
   Playwright `context.route` / `page.route` interception is
   insufficient.

2. **`PhaseStateMachine.ts`** would duplicate the state machine the
   existing `MirrorSimulator` already runs against `MirrorManifest`.
   The honest path is to **reuse** that simulator rather than build a
   second one; `HarToMirrorManifest.ts` is the bridge that lets HAR
   recordings flow into the existing engine.

3. **`SimulatorFactory.ts`** is premature until real HAR captures
   exist and the phase-map sidecar format is finalized (HAR alone
   does not encode the 11-phase chain — it needs a sibling file
   mapping `entries[i]` → `IntegrationPhase`).

These three modules will land in a follow-up PR once the first bank's
HAR is recorded and we can iterate against real data.

## Operator workflow (for when HAR captures land)

1. Record HAR per `<bank> × <phase>` cell:
   ```ts
   const context = await browser.newContext({
     recordHar: { path: 'mirrors/banks/<bank>/<NN>-<phase>.har' },
   });
   ```
2. PII-redact via the existing `PiiRedactor`
   (`src/Tests/Integration/Tools/PiiRedactor.ts`).
3. Run `loadHarEntries(harPath)` + `toManifestRows(entries)` to get
   the row skeleton.
4. Augment each row with `phase`, optional `advanceTo`, and predicates
   (postData / headers / cookies) — these encode the OTP nonce + session
   cookie invariants the simulator enforces.
5. Write body files to disk and fill each row's `response.bodyFile`.
6. Emit the final `manifest.json` and commit to
   `src/Tests/Integration/fixtures/banks/<bank>/manifest.json`.
7. The existing `MirrorSimulator.installSimulator()` consumes the
   manifest unchanged.

## Why `StatefulRewriter` is committed today even though no HAR exists

The sequence-aware "same URL → different response per N-th hit" logic
is the trickiest invariant of the Mode B mirror, and the synthetic
unit tests pin its semantics so that:

- A bank visiting `/api/session` twice during init+post-login does NOT
  silently serve the pre-login response after login.
- A bank visiting a polled `/api/transactions` endpoint exhausts the
  recorded responses in chronological order and reports `exhausted`
  rather than looping back to entry #0.
- Diagnostic counters (`missCount`, `exhaustedCount`) surface manifest
  drift early.

These invariants are independent of any specific bank's data, so
locking them in via unit tests now prevents a regression later when
the real-bank flow lands.

## Out-of-scope (handled elsewhere)

- **Phase state machine** → `../Mirror/MirrorSimulator.ts`.
- **OTP challenge nonces** → `../Mirror/MirrorOtpChallenge.ts`.
- **Escape classification** → `../Mirror/MirrorEscapeClassifier.ts`.
- **PII redaction** → `../Tools/PiiRedactor.ts`.
- **Per-bank coverage matrix** → `../Tools/CheckBankIntegrationCoverage.ts`.
