# API-DIRECT-CALL — Errors and Failure Modes

How a failure is detected, typed and reported without leaking bank reply text.

## Bank text in failures

When a required extract misses, `extractFields` in
`Envelope/GenericEnvelopeParser.ts` names the slot and pointer. By default it
also appends the first non-blank `message`, `explanation` or `error` field of
the reply, cut to 30 characters by `maskVisibleText`:
`envelope selector miss: <slot> at <pointer> — bank said: <text>`.

A bank whose replies can quote the customer back sets `omitBankText: true`.
The miss then reads `envelope selector miss: <slot> at <pointer>` and no reply
text reaches the failure. `buildReduceArgs` reads the flag once per flow and
`collectCarry` hands it to `extractFields`; banks that leave it unset keep
today's message.

The same flag keeps a response's `error_code` out of login diagnostics:
the logger records a length-only hint instead of the bank-supplied value.
Banks that leave the flag unset or false retain their existing diagnostics.

`withApiDirect` copies the flag onto the scrape shape, so the scrape phase
honours it too: a failed scrape call reads `<call> HTTP <status>` and quotes
none of the reply (see
[api-direct-scrape](../api-direct-scrape.md)).

## Step outcome

Some banks refuse a login with HTTP 200 and a status code in the body. A step
that declares `outcome` (an `IStepOutcome`) has that code judged by
`judgeStepOutcome` after the 2xx and before its extracts run:

```ts
outcome: {
  codePointer: '/status',          // RFC-6901 pointer to the code
  successCodes: ['0'],
  failureMap: { '7': ScraperErrorTypes.InvalidPassword },
  defaultFailure: ScraperErrorTypes.Generic,
}
```

The code is compared as text, so a numeric `0` matches `'0'`. A code in
`successCodes` lets the step continue. Any other code fails the step with its
`failureMap` type, or `defaultFailure` when it is unmapped. Only the map's own
keys count, so a code such as `toString` is unmapped. A missing, empty or
non-scalar code also fails with `defaultFailure`. The message is
`<step> outcome <code>` for a mapped code, `<step> outcome unmapped` for any
other code, and `<step> outcome missing` when there is none. An unmapped code
is never echoed: it comes from the bank, not the config, and may carry a
secret. A step without `outcome` behaves as before.

`caseInsensitive: true` lower-cases the code, the `successCodes` and the
`failureMap` keys before matching, for banks whose state codes change case
(`LogonOTP` matches `logonotp`). A mapped code is then named in lower case.

## Bank-error guard

Some banks answer a failed step with HTTP 200 and an error field instead of a
status code. A step that declares `failIfPresent` (a list of body pointers)
has them checked by `guardBankError` right after the body is parsed, before
its `outcome` and before its extracts:

```ts
failIfPresent: ['/error', '/Error', '/errors'],
```

Any pointer that resolves to a truthy scalar or a non-empty array or record
fails the step with `<step> bank error`, whatever the outcome's
`defaultFailure` is. Absent, `null`, `false`, `0`, `''`, `[]` and `{}` are not
errors. The message never echoes the bank's value. `bankErrorOf` builds that
failure, and the [envelope codec](codecs.md#envelope-codec) reuses it; on a step with a
codec the pointers read the opened answer.

The failure is `Generic` unless the step sets `bankErrorType`, for a bank whose
error field on a given step can only mean one thing:

```ts
failIfPresent: ['/data/assertion_error_code'],
bankErrorType: ScraperErrorTypes.InvalidPassword,
```

The type covers every `<step> bank error` of that step, a guard hit or a codec
`error_code`; the message stays the same. The build refuses a `bankErrorType`
on a step with no `failIfPresent` entry and no codec, since it would type an
error the step never raises.

An outcome failure in a warm resume is a failure like any other, so the
resolver still falls back to one cold flow. When the cold flow also fails, its
own failure type is the one reported.

## HTTP failure map

Some banks refuse a step's input with a `4xx` status instead of a 2xx body.
A failed reply is `GENERIC` by default (see
[Transport errors](#transport-errors)). A step whose `4xx` can only mean one
thing names its type per status:

```ts
httpFailureMap: { '401': ScraperErrorTypes.InvalidPassword },
```

Yahav's `register` uses this map: wrong credentials draw a bare `401` there,
and with no reason in the reply every `401` there is reported as
`INVALID_PASSWORD` ([Yahav login](../../banks/yahav.md#login)).

The step still fails with `<step> HTTP <status>`; only the type changes. The
map reads the status only from the transport's reply prefix
(`<VERB> <url> <status>: `), so a reply body that quotes another status cannot
pick a type. A request that got no reply (even one whose reason quotes a
status), a transport policy refusal and a `WAF_BLOCKED` failure keep their own
type.
The in-request `401`/`403` re-mint and the warm-to-cold fallback read the
message, not the type, so a mapped status still triggers both.

The build refuses an empty map, a key that is not a `4xx` status, and a value
other than `INVALID_PASSWORD`, `CHANGE_PASSWORD`, `ACCOUNT_BLOCKED` or
`INVALID_OTP`: `GENERIC` is already the default, and a timeout, network or
edge type would describe the reply as something it is not. The map, with
`failIfPresent` and `bankErrorType`, lives in the contract's `FailureTypes`
slice.

## Transport errors

Every HTTP transport — native fetch and its mTLS variant — names a URL in
its errors and debug logs through `safeUrlForLog`, which keeps only the origin
and path. Query parameters can carry device ids and session values, so they
never reach an error message or a log line. Native fetch also passes
a caught exception's text through `scrubUrlFromText`, so a transport message that
quotes the request URL keeps only its origin and path as well.

A non-2xx response becomes `GENERIC`, with the message
`<VERB> <url> <status>: ` followed by the first 120 characters of the body.
The exception is a Cloudflare block page: a `4xx` HTML page carrying
Cloudflare's `cf-error` markers becomes `WAF_BLOCKED`, and a fixed reason
replaces the body, because that page embeds the caller's IP and a Ray ID.
Cloudflare's `5xx` origin-error pages carry the same markers but mean the bank
itself is unreachable, so they stay `GENERIC`. A Cloudflare challenge is also
`WAF_BLOCKED`, at any status, and is recognised only by its
`cf-mitigated: challenge` response header: Cloudflare injects its
challenge-platform script into ordinary origin pages too, so no body marker
can tell a challenge apart. Cloudflare does not tie that header to a status, so
the HTTP strategy checks it with `hasCloudflareChallengeHeader` before parsing a
`2xx` body; a challenged `2xx` is classified, not parsed. Native fetch
(including its mTLS and GraphQL variants) uses this rule,
`classifyHttpFailure`
(`src/Scrapers/Pipeline/Strategy/Fetch/HttpFailureClassifier.ts`), whose fixed
reasons are `CLOUDFLARE_BLOCK_REASON` and `CLOUDFLARE_CHALLENGE_REASON`. The
`<status>: ` prefix is kept in both cases except for the oversized bounded
block described above, and `WAF_BLOCKED` is terminal — neither the in-request `401`/`403`
re-mint nor the warm-to-cold fallback fires on it, the scrape phase does not
recover the session over it (a cold re-login could send an SMS while the host
stays blocked), and a balance `fallbackOnFail` never masks it. All four paths
ask the predicate `isTerminalFailure`
(`src/Scrapers/Pipeline/Types/Procedure.ts`). A block on the repair itself
is not dropped either: when the edge refuses the re-mint, the request answers
with that `WAF_BLOCKED` instead of the original `401`/`403`, and when it
refuses the scrape phase's session recovery, the phase answers with it
instead of its first outcome. Both go through `preferTerminalFailure` in the same
file.

A login step does not pass that message on, because a bank can echo the
password, the OTP or a device id back in its reply. `sanitiseStepFailure`
(`src/Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.failure.ts`)
reports a failed step as `<step> HTTP <status>` when the bank answered, or as
`<step> <errorType>` (for example `bind TIMEOUT`) when no reply arrived. It
keeps `errorType` and `errorDetails`, except that a step's
[`httpFailureMap`](#http-failure-map) may name the type for the reply's
status, and leaves a `WAF_BLOCKED` failure as it is, since that message
carries a fixed reason instead of the page. The in-request re-mint runs below the step, so it still reads the
original space-delimited `<status>:` marker. A scrape call keeps the
transport message unless its shape sets `omitBankText`; the scrape phase then
passes the failure through `sanitiseStepFailure` with only the call's name, so
it reads `<call> HTTP <status>` and no login `httpFailureMap` applies.

## Failure modes

| `errorType`                                                     | Cause                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_PASSWORD`                                              | Bank rejected credentials                                                                                                                                                                                                                                                                           |
| any type a step's `failureMap` names, else its `defaultFailure` | The step's 2xx body reported a non-success [outcome](#step-outcome) code                                                                                                                                                                                                                            |
| the step's `bankErrorType`, else `GENERIC`                      | The step's 2xx body held a bank error at a `failIfPresent` pointer (`<step> bank error`) — see [Bank-error guard](#bank-error-guard)                                                                                                                                                                |
| `GENERIC`                                                       | The step's answer matched no [classifier](codecs.md#answer-classifier) case or more than one (`<step> answer unrecognized` or `<step> answer ambiguous`), or a capture was refused (`<step> answer capture <slot> missing` or `invalid`)                                                            |
| the type a matched case's `fail` names                          | The step's answer matched a [classifier](codecs.md#answer-classifier) case that fails the step (`<step> answer <case>`)                                                                                                                                                                             |
| `GENERIC`                                                       | A body extract failed its rule (`<step> extract <slot> invalid`) — see [Extract rules](codecs.md#extract-rules)                                                                                                                                                                                     |
| `GENERIC`                                                       | A body extract differed from its `equalsRef` (`<step> extract <slot> mismatch`) — see [Extract rules](codecs.md#extract-rules)                                                                                                                                                                      |
| `GENERIC`                                                       | A GET step's final URL failed its own redirect rules (`<step> final url refused`) — see [Final URL carry](flow.md#final-url-carry)                                                                                                                                                                  |
| `GENERIC`                                                       | A text step's handoff script fell outside the grammar, held no location or more than one, or its URL failed the step's `url` rules (`<step> handoff script unsupported`, `missing`, `ambiguous` or `refused`) — see [Handoff script capture](captures.md#handoff-script-capture)                    |
| `INVALID_OTP`                                                   | Wrong code, or a code that fails its pre-hook `valuePattern` or stated length (`<step> preHook value invalid`) — see [OTP pre-hook guards](auth.md#otp-pre-hook-guards)                                                                                                                             |
| `TWO_FACTOR_RETRIEVER_MISSING`                                  | OTP step reached without callback (`preHook: creds.<field> is not a function`)                                                                                                                                                                                                                      |
| `GENERIC`                                                       | A pre-hook `requires` ref did not resolve, or the OTP callback threw (`preHook: creds.<field>() threw <ErrorName>`) — see [OTP pre-hook guards](auth.md#otp-pre-hook-guards)                                                                                                                        |
| `INVALID_PHONE_NUMBER`                                          | `phoneNumber` cannot be normalised to the bank's wire format — see [Phone normaliser](signing.md#phone-normaliser)                                                                                                                                                                                  |
| `TIMEOUT`                                                       | A step's HTTP call didn't complete (`<step> TIMEOUT`)                                                                                                                                                                                                                                               |
| `GENERIC`                                                       | A step's HTTP call failed: `<step> HTTP <status>` for a non-2xx reply, `<step> GENERIC` for a network error — see [Transport errors](#transport-errors)                                                                                                                                             |
| the type the step's `httpFailureMap` names for the status       | A step's call got a `4xx` reply whose status the step maps (`<step> HTTP <status>`) — see [HTTP failure map](#http-failure-map)                                                                                                                                                                     |
| `GENERIC`                                                       | Signer key missing, response shape drift, a `cryptoField` failure, or a second cold login refused by the [one-SMS budget](auth.md#one-sms-per-run)                                                                                                                                                  |
| `GENERIC`                                                       | `persistent auth options invalid: <category>`, `persistent auth state invalid: <category>` or `persistent auth failed: <category>` — a [durable device auth](auth.md#persistent-durable-device-auth) failure; the categories are listed in [Pepper](../../banks/pepper.md#failures-never-fall-back) |

Back to [API-DIRECT-CALL](../api-direct-call.md).
