# API-DIRECT-CALL

Login + OTP via JSON API. Replaces INIT → HOME → PRE-LOGIN → LOGIN → OTP-TRIGGER → OTP-FILL for api-direct banks (OneZero, Pepper, PayBox) — six browser phases collapse into one headless phase with a declarative step list.

| | |
|---|---|
| **Always-on?** | api-direct banks only |
| **Owner slots** | `apiMediator`, `login`, `api` |
| **Source** | [`ApiDirectCallPhase.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectCall/ApiDirectCallPhase.ts) + [`ApiDirectCallActions.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.ts) + [`Flow/`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/ApiDirectCall/Flow) |

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
| `TIMEOUT` | A step's HTTP call didn't complete |
| `GENERIC` | Signer key missing, response shape drift, or a `cryptoField` failure |
