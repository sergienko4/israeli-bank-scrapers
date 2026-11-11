# API-DIRECT-CALL — Auth Policy and Durable Auth

How the login proves identity: OTP guards, the one-SMS budget, header policy, recovery, and durable device auth.

## OTP pre-hook guards

A step's `preHook` (`IPreStepHook`) asks the caller for a code. Four optional
fields shape that request, and `applyGuardedPreHook` (in
`Flow/SmsOtpFlow.prehookGuard.ts`) runs them around it. The step reducer hands
it one `IPreHookGuardArgs` bundle: the reduce args, the scope, the step and
its hook.

```ts
preHook: {
  awaitCredsField: 'otpCodeRetriever',
  intoCarryField: 'otp',
  hintFrom: 'carry.phone',
  requires: ['cookie.csrfcookie', 'carry.flow'],
  valuePattern: '^\\d{5}$',
  valueLengthRef: 'carry.otpLength',
},
```

Before asking for a code, the pre-hook checks the step's base URL, including
an absolute carried URL under its producer's rule. This also happens without
`requires` or a cookie jar; an invalid URL cannot spend a code on a request
that cannot be sent. A raw query is resolved later because it may use that code.

- `hintFrom` names a carry slot. Its text is passed to the callback as the
  hint, such as the masked phone the bank sent the code to. A slot that is
  missing or not text passes `''`. The hint is never logged.
- `requires` lists refs that must resolve before the callback is asked.
  `checkPreHookRequires` resolves them against the step's own cookie view,
  bound to the step URL as `runStep` binds it. `clientCookieOf` previews the
  step's `setCookies` without committing them before validation, using the
  jar's domain/path precedence and retaining malformed cookie-source failures.
  The first miss fails with the resolver's message
  (`ref carry.<x> missing from scope.carry`, `ref cookie.<x> miss`), so no code
  is spent on a login that cannot finish.
- `valuePattern` is an anchored regex. `checkPreHookValue` tests the
  deposited value; a value that does not match, or is not text, fails the
  step `INVALID_OTP` with `<step> preHook value invalid` before its request
  is sent. The message never names the value.
- `valueLengthRef` names the carry slot where the bank states the code's exact
  length. `statedLength` reads it after `requires`, before the callback
  is asked. An integer 4..10, as a number or as decimal text, means the value
  must be exactly that many ASCII digits, or the step fails `INVALID_OTP` as
  above, so a malformed code never spends an attempt. When the slot is absent,
  `valuePattern` alone applies. Any other value fails `GENERIC` with
  `<step> preHook length invalid`, and no code is asked for.

A creds field that is not a function fails `TWO_FACTOR_RETRIEVER_MISSING`
with `preHook: creds.<field> is not a function`. A callback that throws fails
`GENERIC` with `preHook: creds.<field>() threw <ErrorName>`; from the second
call on it adds `on invocation #<n> of this login`. Only the error's
name is reported: its message can echo a code or a token. `errorNameOf`
(`Types/ErrorUtils.ts`) reports a name only when it is a platform error class
(`TypeError`, `AbortError`, `TimeoutError` and the like) or one of this
library's own (`ScraperError`, `WafBlockError`); any other name, however
class-like, is reported as `Error`. A throwing
`onAuthFlowComplete` callback is logged the same way
(`api-direct-call onAuthFlowComplete callback threw <ErrorName>`).

## One SMS per run

**A single scrape of a single api-direct bank sends at most one SMS.** That is
a guarantee, not an aspiration — `mayStartFlow` enforces it at the one place
every login flow passes through, and `COLD_FLOW_BUDGET` is the cap it draws on.

(The guarantee is scoped to api-direct banks. Browser-OTP banks send their code
from the `otp-trigger` phase, which this budget does not sit behind.)

A _cold_ flow replays the bank's login from the beginning, so it always walks
the step that sends the message — which is not always the first step: PayBox
sends at step 0, OneZero and Pepper at step 1. `isColdStart` is what tells the
two apart: a warm resume carries a `startStepIndex` past the send step, a cold
one does not. A _warm_ resume starts strictly
after the last OTP pre-hook and so cannot send anything. That is enforced, not
assumed: `WarmStartContract` fails any config whose `warmStart.fromStepIndex`
does not clear every OTP step.

The charge is taken when a cold flow _starts_, not when the message provably
leaves. This deliberately over-counts a flow that dies before reaching the send
step. The alternative — charging when the code is collected — under-counts a
flow that sends the message and then dies, and only over-counting keeps "at
most one" true.

### Why it needed enforcing

Nothing counted the messages. `guardedRefreshOp` reads like a cap but is a
re-entrancy latch: it blocks a refresh _nested inside_ a refresh and releases
in `finally`, leaving _sequential_ refreshes unbounded. Since every `apiPost`,
`apiGet` and `apiQuery` funnels through `retryOn401Op`, a session the bank had
decided to refuse bought one fresh login — and one fresh SMS — per rejected
request. Ten rejected calls meant ten messages. This was found by reading the
refresh path, not from a bug report — no issue tracks it.

### What changed for callers

A session that dies mid-scrape used to be repaired in place, silently, at the
cost of a message the caller never asked for. The first repair still happens.
A second is refused rather than replaying a login the bank has already
rejected.

What a refusal looks like depends on what the run has to offer:

- **The run already minted a session.** The refusal hands that bearer back, so
  a scrape that has everything it needs does not fail over a policy cap.
- **It never did.** The refusal surfaces as `GENERIC` carrying
  `BUDGET_SPENT_MESSAGE`.

On the mainline `apiPost`/`apiGet`/`apiQuery` path a caller sees neither:
`retryOn401Op` discards a failed refresh and returns the bank's original
401/403 — the rejection `isAuthRejectionMessage` recognises. The refusal is therefore always logged, because it is the only trace
an operator would otherwise have. The `GENERIC` form reaches callers through
`primeSession` and `recoverSession`.

For OneZero the old behaviour was actively destructive: minting a long-term
token revokes the previous one
([#580](https://github.com/sergienko4/israeli-bank-scrapers/pull/580)), so
each silent re-mint invalidated the token the run was trying to keep.

If a run legitimately needs a second login, start a second scrape.

## Auth-mode policy

`authScheme` decides two things: how a login token becomes the
`Authorization` header, and whether a rejected request may log in again.
`formatAuthValue` renders the header value and `authPolicyOf` looks up the
policy. Both read one table keyed by scheme in `AuthModePolicy.ts`, so a new
scheme is a new row, not a new branch.

| `authScheme`    | Header value                 | `installHeader` | `rearmOnReject` |
| --------------- | ---------------------------- | --------------- | --------------- |
| `raw` (default) | the token                    | yes             | yes             |
| `bearer`        | `Bearer` + space + the token | yes             | yes             |
| `prefixed`      | `authPrefix` + the token     | yes             | yes             |
| `none`          | no header                    | no              | no              |

`prefixed` is for a bank whose header starts with its own scheme word. That
word goes in `authPrefix`, trailing space included. `none` is for a bank whose
session is a cookie. It needs `sessionCookies: true` (see
[HTTP transports](../../architecture/pipeline.md#http-transports)). Its
login may end without a `carry.token`, and the flow then reports an empty
bearer.

`IAuthModePolicy` carries both flags. The mediator needs only
`rearmOnReject`, so it receives the narrower `IMediatorAuthPolicy` through the
`setAuthPolicy` port, which `setAuthPolicyOp` stores in mediator state. Every
mediator must implement the port, so a missing wire fails to compile instead
of silently dropping the policy. The ACTION calls `applyAuthPolicy` before the first login, so a
rejection during the login steps obeys the policy too. `primeAndCheck` then
primes the session. It rejects an empty header only when `installHeader` is
set.

With `rearmOnReject` off, `retryOn401Op` returns the bank's first 401/403 as
is and does not log in again. A cookie session has no header to swap, so a
fresh login would only repeat the one the bank just refused. A mediator that
never receives a policy keeps the default of `rearmOnReject: true`, so banks
that send a header behave exactly as before.

### Auth recovery

`authRecovery` (type `AuthRecovery`) decides what a rejected session does. It
is an overlay on the scheme's policy, looked up in the `AUTH_RECOVERIES` map by
`authPolicyOf`, so a new mode is a new row.

| `authRecovery`          | `rearmOnReject` | `wholeScrapeRecovery` | A 401 or 403 during the scrape                       |
| ----------------------- | --------------- | --------------------- | ---------------------------------------------------- |
| `per-request` (default) | the scheme's    | off                   | the call gets a new token and retries once           |
| `whole-scrape`          | off             | on                    | the call fails, then the scrape recovers and re-runs |

`whole-scrape` is for a bank whose session moves on with each answer. A single
call retried with a new token would carry a session the bank no longer holds,
so the whole scrape starts over instead. `setAuthPolicyOp` stores the flag and
`getWholeScrapeRecoveryOp` reads it back for the mediator's
`recoversWholeScrape()`. The scrape phase reads it to pick its recovery rule;
see [Session recovery](../api-direct-scrape.md#session-recovery).

`recoverSession` re-grants the session rather than logging in again when the
strategy can. It calls the resolver's optional `recover()`, which
`TokenResolverBuilder` binds to the strategy's optional `primeRecover`. A
resolver without one runs `refresh()` (`primeFresh`), as before. Both share the
`isRefreshing` re-entrancy guard in `guardedMintOp`. A 401 or 403 inside one
call still runs `refresh()` through `retryOn401Op`.

The config strategy's `primeRecover` is `primeRecoverImpl`
(`Flow/TokenStrategyFromConfig.recover.ts`). It picks its route from
`RECOVER_ROUTES` by warm kind, so a new kind names its own. A `carry-bundle`
login resumes: the [cookie hand-off](session.md#cookie-hand-off) stash goes back into an
emptied jar (a `shared` hand-off stashed nothing and keeps its jar), the
private carry snapshot seeds the flow, and the flow runs from `fromStepIndex`.
A resume is not a cold start, so it spends no
[one-SMS budget](#one-sms-per-run). A failed resume escalates to one cold
login only when its `coldFallback` gate allows; any other failure is returned.
Every other kind, and every durable session, runs `primeFresh` as before.

The recovery hook (`makeRecoveryHook`) reads the strategy's optional
`lastRecoveryResumed()`. A resumed recovery logs one info line:
`re-granted the session token`. Only a cold one falls to the degraded-session
warning, which still needs a session that was warm. A strategy without the
getter keeps that warning rule alone.

## Persistent (durable) device auth

A bank whose config declares a `persistentAuth` block can keep its device
between runs; every other bank ignores the two options. The block
(`IPersistentAuthConfig`) is a union tagged by `kind` (`PersistentAuthKind`):

- `bound-device` (`IBoundDeviceAuthConfig`) — Pepper. The state holds a bound
  EC key and the last token; resume replays or renews it. The caller-facing
  contract lives in
  [Pepper durable device auth](../../banks/pepper.md#durable-device-auth-opt-in).
- `device-memory` (`IDeviceMemoryAuthConfig`) — the bank remembers a device by
  the id it issued, so a login that sends that id back skips the OTP step.
  See [Device memory](#device-memory).

The sections below describe `bound-device` unless they say otherwise.

`.action` resolves one mode — token-only, enrollment or resume — while it
builds the token strategy, before any auth request. An invalid option
combination fails there, so it never reaches the network.

- **Enrollment** is the bank's normal cold flow, so it draws on the
  [one-SMS budget](#one-sms-per-run) like any cold login. A spent budget fails
  as `enrollment-budget` instead of sending. A malformed credential fails by
  name first and leaves the budget unspent.
- **Resume** decodes and validates the state locally. A token fresh for more
  than `freshnessMarginSeconds` (300 s for Pepper) is replayed with zero auth
  requests. Otherwise the bank's `resumeSteps` run on the persisted device:
  a signed login and one password assertion. They contain no bind and no OTP
  step, so resume never draws on the budget.
- **No fallback.** A durable strategy reports no warm state, so a failed resume
  never falls back to a cold login. Its `primeFresh` fails locally, so a
  401/403 during the scrape cannot recurse into a renewal or an enrollment.
  The mediator then returns that request's original 401/403; the refusal is
  only logged.
- **Publish before use.** A new token is installed only after
  `onPersistentAuthStateUpdate` resolves.
- **No stored value in errors.** Transports drop the query string (see
  [Transport errors](errors.md#transport-errors)), so the persisted device id never
  reaches an error or a log line. A renewal failure reaches the caller as its
  step name and status, never the reply (see
  [Transport errors](errors.md#transport-errors)); any stored value a message still
  quotes is replaced by `[REDACTED]` as a second guard.

A durable run therefore performs at most two auth requests on resume, at most
one state callback, and no SMS outside enrollment.

### Device memory

A `device-memory` block names three things: the `provider` tag the state is
bound to, the carry slot holding the server-issued device id
(`deviceIdField`) and the creds field binding the state to one account
(`accountField`). The state (`IDeviceMemoryStateV1`) is
`{version: 1, kind: 'device-memory', provider, account, deviceId}` in the same
base64url JSON envelope as Pepper's. It holds no token, key or renewal step.

- **Account.** `account` is `creds[accountField]` lower-cased, untrimmed and
  at most 64 characters; a resume compares it exactly, so a username that
  differs only in case still resumes.
- **Device id.** One to 256 characters of letters, digits, `_`, `.`, `:` and
  `-` (`isDeviceMemoryId`).
- **Enrollment** runs the bank's configured login with an empty carry. Once it
  succeeds, the id in `carry[deviceIdField]` is checked and published once
  through `onPersistentAuthStateUpdate`, before the scrape starts.
- **Resume** decodes the state and checks provider and account before any
  request; a mismatch fails by category. It then runs the same login with the
  stored id seeded into carry, so the bank skips its OTP step. The step's
  `keepExisting` optional extract keeps the seeded id even when the reply
  carries a different one, and a resume publishes nothing.
- **Device id check.** In both modes, a login that ends without a valid id in
  carry fails as `persistent auth failed: device-id`.
- **No fallback.** As with `bound-device`, `primeFresh` fails locally, so a
  401/403 during the scrape never repeats the login.
- **Failures.** Invalid state, callback and missing device id use the durable
  categories. A failed login returns `persistent auth failed: flow` with its
  original error type but no bank-controlled response text or error details:
  a bank can echo even a truncated prefix of the stored id or account, which
  replacing whole values would miss.
- **Logging.** One debug line per run carries the mode and whether a state was
  published — never a value.

Where each piece lives, for maintainers:

| Concern             | Symbols                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caller input        | `IPersistentAuthInput` and `PersistentAuthStateCallback`, read from the options by `readPersistentAuthInput`                                                                                                                                                                                                                                                  |
| Mode resolution     | `createContextStrategy` → `resolveContextAuthMode` → `resolvePersistentAuthMode`, producing a `PersistentAuthMode`: legacy, or a `DurableAuthMode` (enroll / resume)                                                                                                                                                                                          |
| State codec         | `encodePersistentAuthState` / `decodePersistentAuthState` over `IPersistentAuthStateV1`. Decoding checks the state against an `IPersistentAuthExpectation` and returns an `IRehydratedPersistentAuth` with the EC key ready to sign                                                                                                                           |
| Device-memory codec | `encodeDeviceMemoryState` / `decodeDeviceMemoryState` over `IDeviceMemoryStateV1`, rules in order: shape, version, kind, provider, account, deviceId                                                                                                                                                                                                          |
| Shared envelope     | `PersistentAuthEnvelope.ts`: `decodeStateObject`, `encodeStateObject`, `hasExactKeySet`, `invalidState`; the shared rules `isBoundedString`, `isExpectedProvider` and `isSupportedVersion` are each an `IStateRule` check                                                                                                                                     |
| Strategy branch     | `primeDurable` dispatches on `PersistentAuthKind` through `PERSISTENT_PRIMERS` to `primeBoundDevice` (replay, renew or enroll) or `primeDeviceMemory`; each gets an `IDurablePrimeArgs` with its block narrowed, plus the `RunConfiguredFlow` runner. `refuseDurableRefresh` is the local `primeFresh` refusal; `durableFail` and `invokeOnUpdate` are shared |
| Build rule          | `API_DIRECT_PERSISTENT_AUTH_RULES` refuses an unknown `kind` (`isPersistentAuthKind`); `resumeStepsOf` gives the other rules a `bound-device` block's `resumeSteps`                                                                                                                                                                                           |
| Secrets in failures | `sanitiseStepFailure` reports a failed step by name and status, never its reply; `scrubPersistedValues` redacts stored values in bound-device renewal failures; `omitFlowFailureText` removes all bank text on device-memory flow failures; transports strip the query string with `safeUrlForLog`                                                            |
| Bank data           | Pepper's `PEPPER_RESUME_STEPS`: signed `/auth/login`, then one password assertion                                                                                                                                                                                                                                                                             |

Back to [API-DIRECT-CALL](../api-direct-call.md).
