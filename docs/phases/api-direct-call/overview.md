# API-DIRECT-CALL — Overview

How the phase is assembled: the shared primitives, the step model and the sub-step contract every api-direct bank reuses.

Every api-direct bank reuses the **same building blocks** below the phase, so adding a new device-bound or symmetric-signing bank is config-only — no mediator code.

## GET steps

A step is a POST unless it says otherwise. `IStepConfig` is the union
`IPostStep | IGetStep`, both built on the shared `IStepBase` fields, and
`StepMethod` names the two verbs. An `IPostStep` (no `method`, or
`method: 'POST'`) carries a `body`. An `IGetStep` sets `method: 'GET'` and
cannot carry one: a GET with a `body` fails type-check, so there is no runtime
check. Step literals written before GET existed name no `method`, so they stay
POSTs and type-check unchanged.

```ts
{
  name: 'bind',
  urlTag: 'auth.bind',
  method: 'GET',
  queryTemplate: { lang: { $literal: 'he' } },
  cookieJar: true,
  extractsToCarry: { token: '/access_token' },
}
```

A GET skips body hydration, the `cryptoField` hook and the AES body
signature. It keeps the query template, the headers, the cookie jar and the
extracts. `fireStep`
(`src/Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.fire.ts`) picks
the bus call by method, so a GET goes through `apiGet` with the query, headers
and Set-Cookie sink that a POST hands to `apiPost`. A config-level signature
header, when one is set, signs the empty body `{}`. On the native
transport a GET goes out with no body and no `content-type` header, while a
POST still sends `application/json`.

## Step headers

A step can add its own headers with `headers`, a map of header name to
`JsonValueTemplate`. They are hydrated against the step's scope on every call,
so `{ $ref: 'carry.<slot>' }` reads the value an earlier step extracted and
`{ $ref: 'uuid' }` is fresh each time. A string value is sent as it is; any
other value is sent as its JSON text (`7` → `"7"`, `true` → `"true"`). A step
header replaces a `staticHeaders` entry of the same name, compared
case-insensitively. The cookie jar's `Cookie` and the signer's `headerName` are
set after it and, in the same case-insensitive way, replace any static or step
header of that name, so only one value is sent. A stored login token's
`authorization` replaces a static or step `Authorization` the same way. The
transport's own `content-type: application/json` default gives way to a static
or step `Content-Type` in any letter case. A reference that does not
resolve fails the step before anything is sent.

```ts
headers: {
  'X-Request-Id': { $ref: 'uuid' },
  'X-Session-Key': { $ref: 'carry.sessionKey' },
}
```

## Conditional steps

Some banks ask for an SMS code only on some logins. A step can carry a
`runIf` guard (`IRunIf`) naming a carry slot and the texts that let it run:

```ts
runIf: { carry: 'state', oneOf: ['logonotp'] },
```

The step reducer calls `isStepSkipped` (in `Flow/SmsOtpFlow.runIf.ts`) before
the step's pre-hook. The step runs only when the slot holds text equal to one
of `oneOf`, compared without case. A false guard, or a slot that is missing or
not text, skips the step: its pre-hook never asks for a code, no request is
sent, and the scope passes to the next step unchanged. The debug log names the
skipped step, never the slot's value.

## Step names and URL tags

A step's `name` is a `StepName` and its `urlTag` is a `WKUrlGroup`. Both are
closed unions, so a misspelt value fails type-check. The flow never branches
on a name: it labels the step in failure messages (`<step> HTTP <status>`,
`<step> outcome <code>`, `<step> outcome unmapped`, `<step> bank error`) and
in the per-step log
context. The URL comes from the bank's `transport.paths`, keyed by
`AuthPathKey`; the registry seeder registers each entry under the same key,
and the step's `urlTag` selects it.

| Kind       | Values                                                                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step names | `bind`, `login`, `assertPassword`, `assertOtp`, `getIdToken`, `sessionToken`, `prime`, `validate`, `deviceKey`, `register`, `resume`, `bootstrap`, `landing`, `logon`, `encryptionKey`, `identify`, `verify`, `otpInit`, `otpVerify`         |
| Auth tags  | `auth.bind`, `auth.login`, `auth.assert`, `auth.logout`, `auth.prime`, `auth.resume`, `auth.service`, `auth.bootstrap`, `auth.landing`, `auth.logon`, `auth.encryptionKey`, `auth.identify`, `auth.verify`, `auth.otpInit`, `auth.otpVerify` |

`identity.*` and `data.*` tags work the same way.

## Password-only chains

A bank that logs in with credentials alone still declares `flow: 'sms-otp'`,
the only flow kind `gateFlowKind` accepts. The flow asks for a code only
through a step's `preHook`. For a step with no `preHook`, `resolveStepScope`
(`Flow/SmsOtpFlow.reduce.ts`) leaves the scope unchanged and the step still
sends its request; otherwise `applyGuardedPreHook` runs its
[guards](auth.md#otp-pre-hook-guards) around `applyPreHook`, which calls the creds
function named by `awaitCredsField`. A chain with no `preHook` on any step
therefore never prompts, even when the caller passes `otpCodeRetriever`.

The PRE stage's diagnostic label (`classifyLoginKind`) still reads `sms-otp`
for a cold run of such a chain. Nothing branches on that label.

## Sub-step contract

| Hook      | What it does                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.pre`    | Resolve `apiDirectCallConfig` from the bank's `PipelineDescriptor`; seed carry.                                                                                                                                                                                                |
| `.action` | Run the declarative step list: each POST step has a body template + optional crypto hook + optional signer; a [GET step](#get-steps) has no body. The mediator hydrates, signs, sends, parses response, updates carry. OTP step calls `credentials.otpCodeRetriever` mid-flow. |
| `.post`   | Validate the final carry has the required slots (auth token, user id).                                                                                                                                                                                                         |
| `.final`  | Publish the final carry via `setSessionContext`; build `IApiFetchContext`; commit `api` + `login` slots.                                                                                                                                                                       |

Back to [API-DIRECT-CALL](../api-direct-call.md).
