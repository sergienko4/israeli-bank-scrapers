# API-DIRECT-CALL

Login + OTP via JSON API. Replaces INIT → HOME → PRE-LOGIN → LOGIN → OTP-TRIGGER → OTP-FILL for api-direct banks (OneZero, Pepper, PayBox, VisaCal, Isracard, Amex, Max, Mizrahi) — six browser phases collapse into one headless phase with a declarative step list.

|                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Always-on?**  | api-direct banks only                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Owner slots** | `apiMediator`, `login`, `api`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Source**      | [`ApiDirectCallPhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectCall/ApiDirectCallPhase.ts) + [`ApiDirectCallActions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.ts) + [`Flow/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/ApiDirectCall/Flow) |

## Unified api-direct primitives

Every api-direct bank reuses the **same building blocks** below the phase, so adding a new device-bound or symmetric-signing bank is config-only — no mediator code.

### Signer (discriminated union)

| Kind       | Used by | Algorithm             | Signature placement     |
| ---------- | ------- | --------------------- | ----------------------- |
| Asymmetric | Pepper  | ECDSA-P256 / RSA-2048 | Header-attached         |
| Symmetric  | PayBox  | AES-CBC-PKCS7         | Body — RFC-6901 pointer |

Banks declare the algorithm + canonical-string parts + key-ref in their `PipelineBankConfig.headless.signer` literal; the mediator dispatches without bank knowledge.

A cold flow generates fresh keypairs. A flow can instead be handed keypairs and
a per-run step list, so it signs with a key the server already bound rather
than a new one. `exportEcP256Pkcs8` persists the P-256 private key as canonical
Base64 PKCS#8, and `importEcP256Pkcs8` rehydrates it. Export writes only a
bundle `isKeypairFor` accepts as ECDSA-P256, so everything it writes imports
back as the same public key and key ID; any other bundle fails as
`EC key export invalid`. Import rejects any other encoding, key type or curve.
Neither error includes key material.

Handed keypairs are checked before any request. `signerSlotOf` maps the signer
algorithm to the bundle slot it signs from (`ec` or `rsa`). `isKeypairFor`
accepts a slot only when its private key has that algorithm's exact type and
curve or modulus, and its public key, key ID and Base64 all derive from that
private key. A bad slot fails as `injected keypair invalid: <slot>`, and an
empty signer slot fails as `injected keypair missing: <slot>`.

### JsonValueTemplate

Declarative body literal with `$ref` tokens:

| Token                        | Resolves to                              |
| ---------------------------- | ---------------------------------------- |
| `$literal: "v"`              | Literal value `"v"`                      |
| `$ref: creds.<field>`        | The credential at that key               |
| `$ref: carry.<slot>`         | The flow's per-step carry slot           |
| `$ref: config.<dotted.path>` | The bank's config object                 |
| `$ref: cookie.<name>`        | The cookie for the step URL, URL-decoded |

One hydration engine serves both `API-DIRECT-CALL` and `API-DIRECT-SCRAPE` step bodies — no per-bank imperative body assembly.

### Carry derivation

- `seedCarryFromCreds` mirrors creds into carry slots at flow init.
- `sha256-prefix-16` derives a stable identifier from another creds field (PayBox uses this to bind its long-term JWT to a phone-derived `deviceId16Hex` — warm-start-stable without the caller persisting state).
- `random-uuid` generates one canonical UUID per flow init, so every step that reads the slot sees the same value — for banks that need a stable client-instance identifier across the steps of one login. A non-empty creds value is mirrored instead.
- `derivedCarry` joins parts with separators + truncation for OTP-encryption keys.
- A step's `deriveCarry` takes the same `IDerivedCarry` entries and runs them once that step's body and header extracts are in scope. `deriveStepCarry` hands them to `applyDerivations`, the evaluator flow-init `derivedCarry` uses, so the parts (`carry.<slot>`, `creds.<field>`, `config.<dotted.path>` such as `config.secrets.<name>`), separator, truncation and failure messages (`derivedCarry: carry.<slot> missing or non-string`) are the same. A part that fails fails the step.

### CryptoField pre-hook

Per-step optional encryption hook: takes a value from carry (e.g. the SMS OTP), AES-encrypts it with a key from `config.secrets.*` or `carry.<slot>`, writes the ciphertext into the outbound body at an RFC-6901 pointer, and scrubs the plaintext. PayBox uses this to encrypt the OTP into `/pin` with a fresh IV at `/pinIv`.

### Phone normaliser

Every api-direct bank declares its wire format in `PipelineBankConfig.headless.phoneNumberFormat`:

| Bank    | Format               | Example         |
| ------- | -------------------- | --------------- |
| OneZero | `international-plus` | `+972000000000` |
| Pepper  | `international-flat` | `972000000000`  |
| PayBox  | `international-dash` | `972-000000000` |

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

### GET steps

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
header, when one is set, signs the empty body `{}`. On the headless native
transport a GET goes out with no body and no `content-type` header, while a
POST still sends `application/json`.

### Step headers

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

### Optional extracts

`extractsToCarry` fails the step when a field is missing. For fields that only
some responses carry, use `optionalExtractsToCarry`, a map of carry slot to
`IOptionalExtract` (`pointer`, optional `fallback`). It is read after the
required extracts and is applied by `extractOptional` in
`Flow/RunStep.optional.ts`:

- When the pointer resolves to a string that is not blank, that string is
  written as it is.
- Otherwise, when `fallback` is set, the fallback is written.
- Otherwise the slot keeps the value an earlier step stored.

An empty or whitespace-only string, a number, `null` or an object all count
as missing, so a blank field never overwrites a live value.

```ts
optionalExtractsToCarry: {
  bcKey: { pointer: '/bean/bcKey' },
  userName: { pointer: '/bean/userName', fallback: '' },
}
```

### Required credentials

`requiredCreds` maps a creds field to a `CredRule`. `checkRequiredCreds` in
`Flow/RequiredCreds.ts` runs before keys are generated or any request is sent.
`admitFlow`
(`src/Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.budget.ts`)
calls it before `mayStartFlow` charges the cold-flow budget, for
`runConfiguredFlow` and a durable enrollment alike, and `prepareSmsOtpFlow`
calls it again for the paths that do not pass the budget:

| Rule        | Accepts                          |
| ----------- | -------------------------------- |
| `nonEmpty`  | a string that is not blank       |
| `digits`    | one or more digits, nothing else |
| `sixDigits` | exactly six digits               |

A missing or non-string value fails every rule. When any field fails, the flow
stops with `Generic` and `Missing or malformed credentials: <names>`. The
message lists field names only, never values. A flow stopped here sends
nothing and so spends nothing: the cold retry after a dropped warm token
names the bad field again rather than the spent budget.

```ts
requiredCreds: { id: 'digits', password: 'nonEmpty', card6Digits: 'sixDigits' }
```

The stored warm token is checked too, before the warm path replays it. It must
be printable ASCII (so no CR/LF or other control characters) and no longer
than `MAX_ACCESS_TOKEN_CHARS` (16 KiB, the cap the durable state already uses
for access tokens). A token that fails is dropped with a warning that names
the creds field, not the value, and the cold login runs instead.

Each prime records an `IWarmSeedVerdict`: whether the caller supplied a seed
(`isWarmSeedSupplied`, true for any value except an absent or empty one, so a
wrong-type value still earns the cold-fallback warning below) and whether it
passed the local checks.
Only an accepted seed lets a failed prime retry once cold (`hasWarmState`). A
refused seed has already run cold, and a second cold flow would only hide the
first failure. The cold-fallback warning reads the verdict rather than
`hasWarmState`: it fires when a supplied seed was refused locally, or was sent
and failed, and the login then finished cold.

The warning ends with a clause naming what the cold login cost, and
`coldFallbackDetail` derives it from the config. A flow with a step whose
`preHook` awaits `otpCodeRetriever` waits for a one-time code, so it says "fell
back to the full SMS login". Any other flow (VisaCal, Isracard) says "fell back
to the full cold login", so the log never claims an SMS the bank did not send.

### Bank text in failures

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

### Step outcome

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

### Bank-error guard

Some banks answer a failed step with HTTP 200 and an error field instead of a
status code. A step that declares `failIfPresent` (a list of body pointers)
has them checked by `guardBankError` right after the body is parsed, before
its `outcome` and before its extracts:

```ts
failIfPresent: ['/error', '/Error', '/errors'],
```

Any pointer that resolves to a truthy scalar or a non-empty array or record
fails the step `Generic` with `<step> bank error`, whatever the outcome's
`defaultFailure` is. Absent, `null`, `false`, `0`, `''`, `[]` and `{}` are not
errors. The message never echoes the bank's value.

An outcome failure in a warm resume is a failure like any other, so the
resolver still falls back to one cold flow. When the cold flow also fails, its
own failure type is the one reported.

### Extract rules

A value the bank sends back may be echoed into a later request, so a step can
check its body extracts before they reach carry. `extractRules` maps a slot of
`extractsToCarry` or `optionalExtractsToCarry` to an `IExtractRule`. Once the
step's carry is read, `ruleStepCarry` (in `Flow/RunStep.extractRules.ts`)
resolves the step's URL and `applyExtractRules` checks each ruled slot:

```ts
optionalExtractsToCarry: { state: { pointer: '/state' } },
extractRules: {
  state: { type: 'string', transform: 'lower', oneOf: ['logonotp', 'passwordexpired'] },
},
```

- `type` (`'string'`, `'number'`, `'object'` or `'array'`) is checked on the
  raw value first. A number must be finite; `null` is no type.
- `transform: 'lower'` lower-cases the text; the slot keeps the result.
- The text checks run in order on the transformed text: `maxChars` (8192 when
  unset), `oneOf`, the whole text against `pattern`, and the `url` allow-list.
  A URL resolves against the step's URL and must then match an `IUrlRule`: an
  `https` origin, an exact path, no user info and no fragment. The slot keeps
  the text as sent, not the resolved URL.
- A string always runs the text checks. A finite number runs them, stringified,
  only when the rule sets one; any other value under a text check is refused.
- An optional slot whose pointer is unresolved, `null` or `''` skips its rule.

A refused value fails the step `Generic` with `<step> extract <slot> invalid`,
before any later step or OTP prompt. The message never names the value.

### Conditional steps

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

### Session-transport fields

Some banks keep the session in cookies shared by sibling hosts, and answer
login calls with redirects, HTML pages or response headers instead of JSON
alone. Their configs use the fields below, all of which need
`headless.nativeFetch`. The transport side of each field is described in
[Headless transports](../architecture/pipeline.md#headless-transports), and
the [build-time config checks](#build-time-config-checks) refuse combinations
that cannot work.

Bank-wide, on `headless`:

```ts
headless: {
  nativeFetch: true,
  sessionCookies: true,
  cookieDomains: ['bank.example'], // a Domain cookie reaches every *.bank.example host
  redirectPolicy: 'reject',        // any 3xx fails unless the step names its own redirect
  statusPolicy: { 204: 'empty' },  // a 204 answers {} without reading the body
}
```

`cookieDomains` needs `sessionCookies`. List only the bank's own registrable
domains, never a public suffix such as `co.il`: the jar trusts the list as
reviewed config and keeps no public-suffix list
([Headless transports](../architecture/pipeline.md#headless-transports)).

A GET step that reaches a page through one allowed redirect:

```ts
{
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  redirect: {
    maxHops: 1,
    allow: [{ origin: 'https://www.bank.example', paths: ['/home'] }],
  },
  response: 'document',       // HTML: read, checked for the marker, discarded
  documentMarker: 'id="app"', // text the page must contain
  extractsToCarry: {},        // a document step reads no body extracts or outcome
}
```

A POST step that echoes a cookie, reads a response header and builds a slot
from what it extracted:

```ts
{
  name: 'logon',
  urlTag: 'auth.logon',
  body: { shape: { user: { $ref: 'creds.userCode' } } },
  headers: { 'X-XSRF-TOKEN': { $literal: '@cookie:XSRF-TOKEN' } },
  extractsToCarry: { userId: '/body/userId' },
  headerExtractsToCarry: { xsrf: { header: 'x-xsrf-token' } },
  deriveCarry: [{ into: 'scrapeKey', parts: ['carry.xsrf', 'carry.userId'], separator: '###' }],
}
```

- `@cookie:<name>` as a header value sends that cookie's current value; the
  header is dropped when the cookie is absent
  ([Headless transports](../architecture/pipeline.md#headless-transports)).
- `redirect` overrides `headless.redirectPolicy` for one step
  ([Redirect policies](../architecture/pipeline.md#redirect-policies)).
- `response: 'document'` and `documentMarker` read a page instead of JSON;
  `statusPolicy` decides a 2xx before any body is read
  ([Document responses and status policies](../architecture/pipeline.md#document-responses-and-status-policies)).
- `headerExtractsToCarry` reads a header of the final response; a missing
  header without `fallback` fails with `<step> header missing`
  ([Response-header carry](../architecture/pipeline.md#response-header-carry)).
- `deriveCarry` runs once the step's extracts are in scope
  ([Carry derivation](#carry-derivation)).
- `encoding: 'form'` sends the body as `application/x-www-form-urlencoded`;
  its shape must be a flat record of `$ref` and scalar `$literal` values
  ([Form bodies](../architecture/pipeline.md#form-bodies)).
- `seal` writes one credential, sealed under the bank's RSA modulus, at a
  body pointer; neither value reaches carry
  ([Sealed fields](../architecture/pipeline.md#sealed-fields)).
- `setCookies` writes client cookies, host-only with `Path=/` and `Secure`,
  before the step's request; `$ref: cookie.<name>` reads the cookie that
  applies to the step URL, URL-decoded
  ([Client cookies](../architecture/pipeline.md#client-cookies)).
- `extractRules` checks a body extract's type, text, length or URL before it
  reaches carry ([Extract rules](#extract-rules)).
- `runIf` skips the step, pre-hook included, unless a carry slot holds one of
  the listed texts ([Conditional steps](#conditional-steps)).
- `omitBankText: true` on the config keeps reply text out of a missed extract
  and records a length-only hint for `error_code` in login diagnostics
  ([Bank text in failures](#bank-text-in-failures)).
- `headless.omitBankText: true` also omits bank text from native HTTP failures,
  including post-login data calls. WAF classification still runs first
  ([Headless transports](../architecture/pipeline.md#headless-transports)).

### Build-time config checks

`validateApiDirectConfig` in `Core/Builder/ApiDirectConfigRules.ts` runs when
the pipeline is built (`build()` → `buildDescriptor` → `validateBuilderFields`).
Its input, `IApiDirectRuleInput`, is the call config plus the bank's `headless`
block from the registry, so a config that cannot work fails before any request
is sent. `Core/Builder/ApiDirectRuleInput.ts` holds that input, the rule shape
`IApiDirectRule` (a message and an `isBroken` check) and `allSteps`, which
lists the login steps and any durable resume steps. The session-transport
rules, `API_DIRECT_TRANSPORT_RULES` in `Core/Builder/ApiDirectTransportRules.ts`,
run after the core rules, then the form-body rules, `API_DIRECT_FORM_RULES` in
`Core/Builder/ApiDirectFormRules.ts`, then the seal rules,
`API_DIRECT_SEAL_RULES` in `Core/Builder/ApiDirectSealRules.ts`, then the
step rules, `API_DIRECT_STEP_RULES` in `Core/Builder/ApiDirectStepRules.ts`. The native-fetch rules, `API_DIRECT_NATIVE_RULES` in
`Core/Builder/ApiDirectNativeRules.ts`, run last: the session-transport fields
act only on the headless native fetch, and any other transport would ignore
them and run unguarded, so naming one off native fetch fails the build. Its
`NATIVE_STEP_FIELDS` and `NATIVE_HEADLESS_FIELDS` lists are the single source
of those field names, shared with the node-tls check. The first broken rule
fails the build with `Generic` and `<field>: <rule>`:

| Broken when                                                                                                                           | Message                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `authScheme: 'prefixed'` with a missing or blank `authPrefix`                                                                         | `authPrefix: required when authScheme is prefixed`                       |
| `authScheme: 'none'` without `headless.sessionCookies: true`                                                                          | `headless.sessionCookies: required when authScheme is none`              |
| `headless.sessionCookies` and any login or resume step with `cookieJar`                                                               | `steps.cookieJar: not allowed with headless.sessionCookies`              |
| any login or resume step whose `outcome.successCodes` is empty                                                                        | `outcome.successCodes: must not be empty`                                |
| `warmStart` validated as `'jwt'` (the default) with no `jwtClaims`                                                                    | `jwtClaims: required when warmStart.validation is jwt`                   |
| `warmStart` validated as `'bank-call'` with a `fromStepIndex` that names no step                                                      | `warmStart.fromStepIndex: must name a step when validation is bank-call` |
| `warmStart.fromStepIndex` below 1                                                                                                     | `warmStart.fromStepIndex: must start after the first step`               |
| `warmStart.fromStepIndex` fractional, `NaN` or above `steps.length`                                                                   | `warmStart.fromStepIndex: must be a whole number up to the step count`   |
| a `response: 'document'` step with any `extractsToCarry`, `optionalExtractsToCarry` or `outcome`                                      | `steps.response: a document step reads no body extracts or outcome`      |
| a `documentMarker` on any step whose `response` is not `'document'`                                                                   | `steps.documentMarker: only on a document step`                          |
| a manual `redirect` on a step whose `method` is not `GET`                                                                             | `steps.redirect: manual only on GET steps`                               |
| a manual `headless.redirectPolicy` (the default every POST shares)                                                                    | `headless.redirectPolicy: manual only on GET steps`                      |
| a manual `redirect` whose `allow` list is empty                                                                                       | `redirect.allow: must not be empty`                                      |
| a manual `redirect` whose `maxHops` is not an integer from 1 to 10                                                                    | `redirect.maxHops: must be an integer from 1 to 10`                      |
| a manual `redirect` on any step while `headless.redirectPolicy` is not `'reject'`                                                     | `headless.redirectPolicy: must be reject when a step redirects manually` |
| a form step whose body shape is not a flat record of `$ref` and scalar `$literal` values                                              | `steps.body: a form body must be a flat record`                          |
| a `seal` whose `kind` is not a `SealKind`                                                                                             | `steps.seal.kind: unknown seal kind`                                     |
| a `seal` on a step that is not a `POST` with a record body                                                                            | `steps.seal: needs a POST step with a record body`                       |
| a `seal` whose `writeTo` is not a JSON pointer                                                                                        | `steps.seal.writeTo: must be a JSON pointer`                             |
| a `seal` whose `params` are out of range (exponent, seed, block size or printable text)                                               | `steps.seal.params: out of range`                                        |
| a login or resume step with a `failIfPresent` entry that is not a JSON pointer below the body root                                    | `steps.failIfPresent: each entry must be a JSON pointer`                 |
| an `extractRules` key that names neither an `extractsToCarry` nor an `optionalExtractsToCarry` slot of its step                       | `steps.extractRules: each key must name a body extract`                  |
| an `extractRules` `pattern` that does not start with `^`, end with `$` and compile with the `u` flag                                  | `steps.extractRules.pattern: must be an anchored regex`                  |
| an `extractRules` `maxChars` that is not an integer from 1 to 65536                                                                   | `steps.extractRules.maxChars: must be an integer from 1 to 65536`        |
| an `extractRules` `oneOf` or `url` list that is empty                                                                                 | `steps.extractRules: oneOf and url must not be empty`                    |
| a login or resume step whose `runIf` has a blank `carry` or an empty `oneOf`                                                          | `steps.runIf: carry and oneOf must not be empty`                         |
| a login or resume step with `response`, `documentMarker`, `redirect` or `headerExtractsToCarry`, without `headless.nativeFetch: true` | `steps.<field>: not allowed without headless.nativeFetch`                |
| a login or resume step with `encoding`, without `headless.nativeFetch: true`                                                          | `steps.encoding: not allowed without headless.nativeFetch`               |
| `headless.cookieDomains`, `redirectPolicy`, `statusPolicy` or `omitBankText` without `headless.nativeFetch: true`, on an api-direct or node-tls bank | `headless.<field>: not allowed without headless.nativeFetch` |
| `headless.cookieDomains` without `headless.sessionCookies: true`                                                                      | `headless.cookieDomains: not allowed without headless.sessionCookies`    |
| a `headerExtractsToCarry` header name that is not an HTTP token (RFC 9110)                                                            | `headerExtractsToCarry.header: must be an HTTP header name`              |
| a login or resume step with `setCookies`, without `headless.cookieDomains`                                                            | `steps.setCookies: not allowed without headless.cookieDomains`           |
| a `setCookies` cookie name that is not an HTTP token (RFC 9110)                                                                       | `steps.setCookies: each name must be an HTTP token`                      |

`warmStart.validation` says how a stored token is judged before reuse. `'jwt'`
reads its expiry through `jwtClaims`. `'bank-call'` is for a token with no
readable expiry, so the first warm step sent to the bank is the check, and
`fromStepIndex` must name a step. A `'bank-call'` seed skips the local JWT
check even when `jwtClaims` is set. In either mode a warm start must skip
step 0: a resume from the first step replays the whole login, OTP step
included, and `isColdStart` charges it to the one-SMS budget, leaving nothing
for the cold retry if the bank rejects the seed. A config with no steps is
no exception: `isColdStart` charges index 0 whether or not a step runs.
`fromStepIndex` equal to `steps.length` runs no steps, because the stored value
is already the final token. A fractional or `NaN` index fails the build,
because the step walker would read a missing step and throw instead of
failing the warm attempt into the cold retry. An index above `steps.length`
fails it too: it would silently run no steps, which only a typo produces.
The warm-start canary (`WarmStartContract`) follows the same policy. It
requires `jwtClaims` only for `'jwt'` validation, and it requires the warm path
to end holding a `token` only when the auth scheme sends a header (`none`
does not).
Conflicting transport flags in the headless block are a separate check
(`assertSingleTransport`), run when the headless mediator is wired.

### Transport errors

Every transport — native fetch, Camoufox page fetch and mTLS — names a URL in
its errors and debug logs through `safeUrlForLog`, which keeps only the origin
and path. Query parameters can carry device ids and session values, so they
never reach an error message or a log line. Native fetch and Camoufox also pass
a caught exception's text through `scrubUrlFromText`, so an engine message that
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
both strategies check it with `hasCloudflareChallengeHeader` before parsing a
`2xx` body; a challenged `2xx` is classified, not parsed. Native fetch
(including its mTLS
and GraphQL variants) and Camoufox page fetch share this one rule,
`classifyHttpFailure`
(`src/Scrapers/Pipeline/Strategy/Fetch/HttpFailureClassifier.ts`), whose fixed
reasons are `CLOUDFLARE_BLOCK_REASON` and `CLOUDFLARE_CHALLENGE_REASON`. The
`<status>: ` prefix is kept
in both cases, and `WAF_BLOCKED` is terminal — neither the in-request `401`/`403`
re-mint nor the warm-to-cold fallback fires on it, the scrape phase does not
recover the session over it (a cold re-login could send an SMS while the host
stays blocked), and a balance `fallbackOnFail` never masks it. All four paths
ask the one predicate `isWafBlocked`
(`src/Scrapers/Pipeline/Types/Procedure.ts`). A block on the repair itself
is not dropped either: when the edge refuses the re-mint, the request answers
with that `WAF_BLOCKED` instead of the original `401`/`403`, and when it
refuses the scrape phase's session recovery, the phase answers with it
instead of its first outcome. Both go through `preferWafBlock` in the same
file.

A login step does not pass that message on, because a bank can echo the
password, the OTP or a device id back in its reply. `sanitiseStepFailure`
(`src/Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.failure.ts`)
reports a failed step as `<step> HTTP <status>` when the bank answered, or as
`<step> <errorType>` (for example `bind TIMEOUT`) when no reply arrived. It
keeps `errorType` and `errorDetails`, and leaves a `WAF_BLOCKED` failure as it
is, since that message carries a fixed reason instead of the page. A failure
raised before any request is sent, such as `CAMOUFOX_LAUNCH_FAILED` when the
browser will not start, passes unchanged too: it holds no bank reply, and the
consumer-install gate reads it. `isLocalFailureMessage`
(`src/Scrapers/Pipeline/Strategy/Fetch/LocalFailureReasons.ts`) matches such a
reason only at the start of the message, so a reply that quotes one is still
cut down. The in-request re-mint runs below the step, so it still reads the
original ` <status>: ` marker. Scrape-phase requests keep the transport
message.

### Step names and URL tags

A step's `name` is a `StepName` and its `urlTag` is a `WKUrlGroup`. Both are
closed unions, so a misspelt value fails type-check. The flow never branches
on a name: it labels the step in failure messages (`<step> HTTP <status>`,
`<step> outcome <code>`, `<step> outcome unmapped`, `<step> bank error`) and
in the per-step log
context. The URL comes from the bank's `headless.paths`, keyed by
`AuthPathKey`; the registry seeder registers each entry under the same key,
and the step's `urlTag` selects it.

| Kind       | Values                                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step names | `bind`, `login`, `assertPassword`, `assertOtp`, `getIdToken`, `sessionToken`, `prime`, `validate`, `deviceKey`, `register`, `resume`, `bootstrap`, `landing`, `logon` |
| Auth tags  | `auth.bind`, `auth.login`, `auth.assert`, `auth.logout`, `auth.prime`, `auth.resume`, `auth.service`, `auth.bootstrap`, `auth.landing`, `auth.logon`                  |

`identity.*` and `data.*` tags work the same way.

### Password-only chains

A bank that logs in with credentials alone still declares `flow: 'sms-otp'`,
the only flow kind `gateFlowKind` accepts. The flow asks for a code only
through a step's `preHook`. For a step with no `preHook`, `resolveStepScope`
(`Flow/SmsOtpFlow.reduce.ts`) leaves the scope unchanged and the step still
sends its request; otherwise `applyPreHook` first calls the creds function
named by `awaitCredsField`. A chain with no `preHook` on any step therefore
never prompts, even when the caller passes `otpCodeRetriever`.

The PRE stage's diagnostic label (`classifyLoginKind`) still reads `sms-otp`
for a cold run of such a chain. Nothing branches on that label.

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
[Headless transports](../architecture/pipeline.md#headless-transports)). Its
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

## Persistent (durable) device auth

A bank whose config declares a `persistentAuth` block can keep its bound device
between runs. Pepper is the only one today; every other bank ignores the two
options. The caller-facing contract lives in
[Pepper durable device auth](../banks/pepper.md#durable-device-auth-opt-in).

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
  [Transport errors](#transport-errors)), so the persisted device id never
  reaches an error or a log line. A renewal failure reaches the caller as its
  step name and status, never the reply (see
  [Transport errors](#transport-errors)); any stored value a message still
  quotes is replaced by `[REDACTED]` as a second guard.

A durable run therefore performs at most two auth requests on resume, at most
one state callback, and no SMS outside enrollment.

Where each piece lives, for maintainers:

| Concern             | Symbols                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caller input        | `IPersistentAuthInput` and `PersistentAuthStateCallback`, read from the options by `readPersistentAuthInput`                                                                                                                        |
| Mode resolution     | `createContextStrategy` → `resolveContextAuthMode` → `resolvePersistentAuthMode`, producing a `PersistentAuthMode`: legacy, or a `DurableAuthMode` (enroll / resume)                                                                |
| State codec         | `encodePersistentAuthState` / `decodePersistentAuthState` over `IPersistentAuthStateV1`. Decoding checks the state against an `IPersistentAuthExpectation` and returns an `IRehydratedPersistentAuth` with the EC key ready to sign |
| Strategy branch     | `primeDurable` (replay, renew or enroll) and `refuseDurableRefresh` (the local `primeFresh` refusal)                                                                                                                                |
| Secrets in failures | `sanitiseStepFailure` reports a failed step by name and status, never its reply; `scrubPersistedValues` still redacts any stored value a renewal failure quotes; transports strip the query string with `safeUrlForLog`             |
| Bank data           | Pepper's `PEPPER_RESUME_STEPS`: signed `/auth/login`, then one password assertion                                                                                                                                                   |

## Sub-step contract

| Hook      | What it does                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.pre`    | Resolve `apiDirectCallConfig` from the bank's `PipelineDescriptor`; seed carry.                                                                                                                                                                                                |
| `.action` | Run the declarative step list: each POST step has a body template + optional crypto hook + optional signer; a [GET step](#get-steps) has no body. The mediator hydrates, signs, sends, parses response, updates carry. OTP step calls `credentials.otpCodeRetriever` mid-flow. |
| `.post`   | Validate the final carry has the required slots (auth token, user id).                                                                                                                                                                                                         |
| `.final`  | Publish the final carry via `setSessionContext`; build `IApiFetchContext`; commit `api` + `login` slots.                                                                                                                                                                       |

## Failure modes

| `errorType`                                                     | Cause                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_PASSWORD`                                              | Bank rejected credentials                                                                                                                                                                                                                                                                 |
| any type a step's `failureMap` names, else its `defaultFailure` | The step's 2xx body reported a non-success [outcome](#step-outcome) code                                                                                                                                                                                                                  |
| `GENERIC`                                                       | The step's 2xx body held a bank error at a `failIfPresent` pointer (`<step> bank error`) — see [Bank-error guard](#bank-error-guard)                                                                                                                                                      |
| `GENERIC`                                                       | A body extract failed its rule (`<step> extract <slot> invalid`) — see [Extract rules](#extract-rules)                                                                                                                                                                                    |
| `INVALID_OTP`                                                   | Wrong code                                                                                                                                                                                                                                                                                |
| `TWO_FACTOR_RETRIEVER_MISSING`                                  | OTP step reached without callback                                                                                                                                                                                                                                                         |
| `INVALID_PHONE_NUMBER`                                          | `phoneNumber` cannot be normalised to the bank's wire format — see [Phone normaliser](#phone-normaliser)                                                                                                                                                                                  |
| `TIMEOUT`                                                       | A step's HTTP call didn't complete (`<step> TIMEOUT`)                                                                                                                                                                                                                                     |
| `GENERIC`                                                       | A step's HTTP call failed: `<step> HTTP <status>` for a non-2xx reply, `<step> GENERIC` for a network error — see [Transport errors](#transport-errors)                                                                                                                                   |
| `GENERIC`                                                       | Signer key missing, response shape drift, a `cryptoField` failure, or a second cold login refused by the [one-SMS budget](#one-sms-per-run)                                                                                                                                               |
| `GENERIC`                                                       | `persistent auth options invalid: <category>`, `persistent auth state invalid: <category>` or `persistent auth failed: <category>` — a [durable device auth](#persistent-durable-device-auth) failure; the categories are listed in [Pepper](../banks/pepper.md#failures-never-fall-back) |
