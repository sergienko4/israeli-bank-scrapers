# API-DIRECT-CALL

Login + OTP via JSON API. Replaces INIT → HOME → PRE-LOGIN → LOGIN → OTP-TRIGGER → OTP-FILL for api-direct banks (OneZero, Pepper, PayBox) — six browser phases collapse into one headless phase with a declarative step list.

| | |
|---|---|
| **Always-on?** | api-direct banks only |
| **Owner slots** | `apiMediator`, `login`, `api` |
| **Source** | [`ApiDirectCallPhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectCall/ApiDirectCallPhase.ts) + [`ApiDirectCallActions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.ts) + [`Flow/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/ApiDirectCall/Flow) |

## Unified api-direct primitives

Every api-direct bank reuses the **same building blocks** below the phase, so adding a new device-bound or symmetric-signing bank is config-only — no mediator code.

### Signer (discriminated union)

| Kind | Used by | Algorithm | Signature placement |
|---|---|---|---|
| Asymmetric | Pepper | ECDSA-P256 / RSA-2048 | Header-attached |
| Symmetric | PayBox | AES-CBC-PKCS7 | Body — RFC-6901 pointer |

Banks declare the algorithm + canonical-string parts + key-ref in their `PipelineBankConfig.headless.signer` literal; the mediator dispatches without bank knowledge.

### JsonValueTemplate

Declarative body literal with `$ref` tokens:

| Token | Resolves to |
|---|---|
| `$literal: "v"` | Literal value `"v"` |
| `$ref: creds.<field>` | The credential at that key |
| `$ref: carry.<slot>` | The flow's per-step carry slot |
| `$ref: config.<dotted.path>` | The bank's config object |

One hydration engine serves both `API-DIRECT-CALL` and `API-DIRECT-SCRAPE` step bodies — no per-bank imperative body assembly.

### Carry derivation

- `seedCarryFromCreds` mirrors creds into carry slots at flow init.
- `sha256-prefix-16` derives a stable identifier from another creds field (PayBox uses this to bind its long-term JWT to a phone-derived `deviceId16Hex` — warm-start-stable without the caller persisting state).
- `derivedCarry` joins parts with separators + truncation for OTP-encryption keys.

### CryptoField pre-hook

Per-step optional encryption hook: takes a value from carry (e.g. the SMS OTP), AES-encrypts it with a key from `config.secrets.*` or `carry.<slot>`, writes the ciphertext into the outbound body at an RFC-6901 pointer, and scrubs the plaintext. PayBox uses this to encrypt the OTP into `/pin` with a fresh IV at `/pinIv`.

### Phone normaliser

Every api-direct bank declares its wire format in `PipelineBankConfig.headless.phoneNumberFormat`:

| Bank | Format | Example |
|---|---|---|
| OneZero | `international-plus` | `+972000000000` |
| Pepper | `international-flat` | `972000000000` |
| PayBox | `international-dash` | `972-000000000` |

Callers always pass digits-only international form; the ACTION-stage mediator rewrites once before the flow runs.

A value already in the bank's own wire form — the third column above — is
accepted unchanged. The per-bank guides document that form as the value to
pass, so normalising it has to be a no-op rather than a rejection. The check is
an exact round-trip, so a near-miss like `972-000-000-000` is still refused.

A value it cannot rewrite — a shape that is neither the digits-only form nor
this bank's exact wire form, shorter than 10 digits, or lacking the `972`
country code (which includes the natural local form `05XXXXXXXX`) — **fails
the run** with `INVALID_PHONE_NUMBER`, before a bus is built and before
anything reaches the network.

It used to log a warning and hand the raw value on "for downstream
validation". There is no downstream validation: Pepper reads
`credentials.phoneNumber` straight into its `x-user-id` header, so the
unusable value went to the bank as-is and came back as an opaque auth failure
that named nothing. See
[#552](https://github.com/sergienko4/israeli-bank-scrapers/issues/552).

## One SMS per run

**A single scrape of a single api-direct bank sends at most one SMS.** That is
a guarantee, not an aspiration — `mayStartFlow` enforces it at the one place
every login flow passes through, and `COLD_FLOW_BUDGET` is the cap it draws on.

(The guarantee is scoped to api-direct banks. Browser-OTP banks send their code
from the `otp-trigger` phase, which this budget does not sit behind.)

A *cold* flow replays the bank's login from the beginning, so it always walks
the step that sends the message — which is not always the first step: PayBox
sends at step 0, OneZero and Pepper at step 1. `isColdStart` is what tells the
two apart: a warm resume carries a `startStepIndex` past the send step, a cold
one does not. A *warm* resume starts strictly
after the last OTP pre-hook and so cannot send anything. That is enforced, not
assumed: `WarmStartContract` fails any config whose `warmStart.fromStepIndex`
does not clear every OTP step.

The charge is taken when a cold flow *starts*, not when the message provably
leaves. This deliberately over-counts a flow that dies before reaching the send
step. The alternative — charging when the code is collected — under-counts a
flow that sends the message and then dies, and only over-counting keeps "at
most one" true.

### Why it needed enforcing

Nothing counted the messages. `guardedRefreshOp` reads like a cap but is a
re-entrancy latch: it blocks a refresh *nested inside* a refresh and releases
in `finally`, leaving *sequential* refreshes unbounded. Since every `apiPost`,
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

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Resolve `apiDirectCallConfig` from the bank's `PipelineDescriptor`; seed carry. |
| `.action` | Run the declarative step list: each step has a body template + optional crypto hook + optional signer. The mediator hydrates, signs, sends, parses response, updates carry. OTP step calls `credentials.otpCodeRetriever` mid-flow. |
| `.post` | Validate the final carry has the required slots (auth token, user id). |
| `.final` | Publish the final carry via `setSessionContext`; build `IApiFetchContext`; commit `api` + `login` slots. |

## Failure modes

| `errorType` | Cause |
|---|---|
| `INVALID_PASSWORD` | Bank rejected credentials |
| `INVALID_OTP` | Wrong code |
| `TWO_FACTOR_RETRIEVER_MISSING` | OTP step reached without callback |
| `INVALID_PHONE_NUMBER` | `phoneNumber` cannot be normalised to the bank's wire format — see [Phone normaliser](#phone-normaliser) |
| `TIMEOUT` | A step's HTTP call didn't complete |
| `GENERIC` | Signer key missing, response shape drift, a `cryptoField` failure, or a second cold login refused by the [one-SMS budget](#one-sms-per-run) |
