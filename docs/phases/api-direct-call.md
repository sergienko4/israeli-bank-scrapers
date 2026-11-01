# API-DIRECT-CALL

Login + OTP via JSON API. Replaces INIT → HOME → PRE-LOGIN → LOGIN → OTP-TRIGGER → OTP-FILL for api-direct banks (OneZero, Pepper, PayBox, VisaCal, Isracard, Amex, Max, Mizrahi, Hapoalim, Yahav) — six browser phases collapse into one headless phase with a declarative step list.

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
| `$join: { parts, … }`        | One string built from refs and literals  |
| `$merge: { base, set }`      | A carried record with `set` laid over it |

A `$join` node (`IJoinTemplate`, N24) concatenates its `parts` in order. Each
`JoinPart` is a ref token (`'creds.password'`) or a literal (`{ literal: '-' }`).
`encode: 'base64'` (`JoinEncoding`) encodes the joined text as base64 over its
UTF-8 bytes, and `prefix` goes in front of the result. `hydrateJoin` computes
the value at hydration time, so a Basic `authorization` header or a composed
username never touches carry:

```typescript
headers: {
  authorization: {
    $join: {
      parts: ['creds.username', { literal: ':' }, 'creds.password'],
      encode: 'base64',
      prefix: 'Basic ',
    },
  },
},
```

A part that does not resolve fails hydration with the same error as a missing
`$ref`. A part that resolves to a value that is not a string fails with
`$join part <token> is not a string`.

A `$merge` node (`IMergeTemplate`, N37) sends back a form the bank handed out
([Login-form capture](#login-form-capture)). `hydrateMerge` (in
`Template/MergeTemplate.ts`) resolves `base`, a `carry.<slot>` holding a flat
record of strings, and lays the hydrated `set` over it: a `set` key replaces
the base value in place, a new one goes last. A base that does not resolve
fails like a missing `$ref`; one that is not a flat string record fails
`$merge base <token> not a flat string record`, naming no value. Only a form
body's whole shape may be a `$merge`:

```typescript
encoding: 'form',
body: {
  shape: {
    $merge: {
      base: 'carry.loginForm',
      set: { passwordEnc: { $ref: 'carry.token' }, user: { $ref: 'creds.username' } },
    },
  },
},
```

One hydration engine serves both `API-DIRECT-CALL` and `API-DIRECT-SCRAPE` step bodies — no per-bank imperative body assembly.

### Carry derivation

- `seedCarryFromCreds` mirrors creds into carry slots at flow init.
- `sha256-prefix-16` derives a stable identifier from another creds field (PayBox uses this to bind its long-term JWT to a phone-derived `deviceId16Hex` — warm-start-stable without the caller persisting state).
- `random-uuid` generates one canonical UUID per flow init, so every step that reads the slot sees the same value — for banks that need a stable client-instance identifier across the steps of one login. A non-empty creds value is mirrored instead.
- `random-hex` (`IRandomHexBootstrap`, N42) draws `bytes` (1 to 64) fresh random bytes per flow init as hex, twice as many characters, upper-case when `isUpperCase` is set — for a flow identifier of a fixed length and case. `evalRandomBootstrap` (in `Flow/FlowInitCarry.random.ts`) serves it and the other `RandomBootstrap` kinds, `random-hex-16` and `random-uuid`, once `isRandomBootstrap` matches; a non-empty creds value is mirrored instead.
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

### Raw query

Some banks read a query byte for byte, so a percent-encoded `queryTemplate`
pair would not match what they expect. Such a step sets `rawQuery` (N41), an
`IJoinTemplate`: the `parts`, optional `prefix` and optional `encode` of a
`$join`. The joined text goes after the step URL's `?` as it is. When the URL
already has a query, the text follows an `&` instead.

The text must be 1 to 32 768 printable-ASCII characters (`\x21` to `\x7E`)
with no `#`, `<`, `>`, `"`, `'` or `\`, since a URL would encode or cut those.
Any other text fails the step with `<step> raw query invalid` before anything
is sent. A part that does not resolve fails the step as it does in a `$join`.
A step cannot set both `rawQuery` and `queryTemplate`: the build fails with
`steps.rawQuery: not with queryTemplate`.

```ts
{
  name: 'sessionToken',
  urlTag: 'auth.bind',
  method: 'GET',
  rawQuery: { prefix: 'code=', parts: ['carry.ssoCode'] },
  extractsToCarry: {},
}
```

`stepUrlOf` (`Flow/RunStep.stepUrl.ts`) resolves the step URL with its raw
query, so the canonical `pathAndQuery` carries it too. It reads an
`IStepUrlInput`: the step, its scope and its company. `sendTargetOf` gives the
bus that URL as a literal, so the transport sends it unchanged; `ITokenBus`
takes a `WKUrlOrLiteral`. A step with neither a raw query nor a carried URL
(below) still goes to the bus as its WK tag.

### Carried step URL

Some banks hand the client the next URL to call, as a redirect target or as a
field in an answer. A GET step sends there when it names `urlFromCarry` (N40),
the carry slot holding that URL. Its `urlTag` still names the step but is not
sent to. A POST cannot name it, since `IPostStep.urlFromCarry` is `never`.

The slot must hold the text of an absolute URL that an earlier step's
`extractRules` `url` rule checked. A slot that no earlier step in the same
list (login steps, or resume steps) checks with a `url` rule fails the build
with `steps.urlFromCarry: slot needs an earlier url rule`. At run time, a slot
that is missing, not text, or not an absolute URL fails the step with
`<step> carried url invalid` before anything is sent. A relative URL is
refused, since nothing at that point knows what it was relative to.

```ts
{
  name: 'landing',
  urlTag: 'auth.bind',
  method: 'GET',
  urlFromCarry: 'handoffUrl',
  extractsToCarry: {},
}
```

`stepBaseUrlOf` (`Flow/RunStep.stepUrl.ts`) gives the carried URL, or else the
WK url, before any query. The step's jar view and client cookies bind to it,
and its pre-hook `requires` read cookies through it. Its relative
`extractRules` URLs and its form action resolve against it. `stepUrlOf` adds
the raw query on top, so the two combine. `sendTargetOf` hands the bus the
resulting URL as a literal.

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

| Rule        | Accepts                                                      |
| ----------- | ------------------------------------------------------------ |
| `nonEmpty`  | a string that is not blank                                   |
| `digits`    | one or more digits, nothing else                             |
| `sixDigits` | exactly six digits                                           |
| `latin1`    | a string that is not blank, every char ≤ U+00FF (ISO-8859-1) |

`latin1` lets a bank that sends a credential through a `form-latin1` step
refuse an unencodable one before its first request, rather than at that step.

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
errors. The message never echoes the bank's value. `bankErrorOf` builds that
failure, and the [envelope codec](#envelope-codec) reuses it; on a step with a
codec the pointers read the opened answer.

An outcome failure in a warm resume is a failure like any other, so the
resolver still falls back to one cold flow. When the cold flow also fails, its
own failure type is the one reported.

### Extract rules

A value the bank sends back may be echoed into a later request, so a step can
check its body, header and text-capture slots before they reach carry.
`extractRules` maps a slot of `extractsToCarry`, `optionalExtractsToCarry`,
`headerExtractsToCarry` or `textCaptures` to an `IExtractRule`. Once the
step's carry is read,
`ruleStepCarry` (in `Flow/RunStep.extractRules.ts`) resolves the step's URL
and `applyExtractRules` checks each ruled slot:

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
  unset), `oneOf`, the whole text against `pattern`, the `url` allow-list and
  `pemCertificate`. A URL resolves against the step's URL and must then match
  an `IUrlRule`: an `https` origin, an exact path (or, with `anyPathExcept`,
  any path holding none of the denied texts), no user info and no fragment.
  The slot keeps the text as sent, not the resolved URL.
- `pemCertificate: { keyRef }` (`IPemCertificateRule`, N27) is checked by
  `isPemCertificate` (in `Flow/RunStep.pemRule.ts`). It demands exactly one
  PEM block, a `CERTIFICATE` that parses as X.509, certifies the private key
  `keyRef` resolves to and is valid now (`validFrom ≤ now ≤ validTo`). The key
  ref resolves to text with `resolveRefText` (in `Template/RefResolver.ts`)
  against the step's prepared scope, so it reads a key an earlier step or this
  step's [generators](#carry-generators) put in carry.
- A string always runs the text checks. A finite number runs them, stringified,
  only when the rule sets one; any other value under a text check is refused.
- An optional slot whose pointer is unresolved, `null` or `''` skips its rule.
  A header slot is always ruled: it holds the header, or its `fallback`.

```ts
headerExtractsToCarry: { deviceStatus: { header: 'device-status' } },
extractRules: {
  certPem: { type: 'string', pemCertificate: { keyRef: 'carry.certKeyPem' } },
  deviceStatus: { oneOf: ['activated'] },
},
```

A refused value fails the step `Generic` with `<step> extract <slot> invalid`,
before any later step or OTP prompt. The message never names the value.

### Text captures

A bank that answers with a page or a script rather than JSON can still hand a
value to carry. On a `response: 'text'` step, `textCaptures` maps a carry slot
to an `ITextCapture` (N36): a regex `pattern`, searched in the whole answer
with the `g` flag, and the `group` whose text the slot takes (`0` is the whole
match). `captureText` (in `Flow/RunStep.textCapture.ts`) runs right after the
header slots, through `answerSlots` (in `Flow/RunStep.answerSlots.ts`):

```ts
response: 'text',
maxTextChars: 262_144,
textCaptures: {
  ssoCode: { pattern: '^[\\s\\S]*?code=([\\s\\S]+)$', group: 1 },
  csrf: { pattern: 'csrfToken', group: 0, absent: true },
},
```

- The pattern must match exactly once. No match, or a match that leaves the
  group unset, fails `<step> capture <slot> missing`; a second match fails
  `<step> capture <slot> ambiguous`. An empty match steps one char on before
  the second search, so a pattern that can match `''` is still caught twice.
- `absent: true` makes the capture a guard: any match fails
  `<step> capture <slot> present`, and the slot never enters carry, so no
  extract rule may name it.
- A captured slot then runs its [extract rules](#extract-rules). A slot with no
  rule of its own still gets the empty rule, so it is capped at 8192 chars.
- `maxTextChars` moves the step's answer cap off the 65 536-char default; an
  answer over it fails `<step> text too long`, never truncated.
- A failure names the step and the slot only, never the text.

### Login-form capture

Some banks hand out a login form whose hidden fields the logon post must send
back. On a `response: 'text'` step, `formCapture` (an `IFormCapture`, N37)
reads one form's hidden fields into a carry slot. `captureForm` (in
`Flow/RunStep.formCapture.ts`) runs through `answerSlots` after the text
captures, on the page `answerText` reads off the `{ text }` answer:

```ts
response: 'text',
formCapture: {
  form: 'loginServlet',
  into: 'loginForm',
  action: 'https://bank.example/MatafLoginService/MatafLoginServlet',
  required: ['user', 'passwordEnc', 'bankId'],
  forbidden: ['password'],
  minFields: 3,
  maxFields: 32,
},
```

- `scanHtmlTags` (in `Flow/HtmlTags.ts`) reads the page once, left to right,
  into `IHtmlTag` start and end tags. It skips comments, doctypes and the
  bodies of `script` and `style`; an unclosed comment, tag or quoted value
  ends the scan. `attrsOf` (in `Flow/HtmlTags.attrs.ts`) reads a tag's
  attributes into `HtmlAttrs`: lower-cased names, the last of a repeated name
  wins, and an attribute with no `=` reads `true` (`HtmlAttrValue`). Values
  decode `&amp;`, `&lt;`, `&gt;`, `&quot;` and numeric references only; any
  other named entity stays as written.
- The page must hold exactly one `<form>` whose `id` or `name` is `form`: none
  fails `<step> form <form> missing`, more `<step> form <form> ambiguous`.
- The form's `method` must be `post` in any case, and its `action`, resolved
  against the step URL, must equal `action`; anything else, a missing method
  or action included, fails `<step> form action refused`.
- Its fields are the inputs with a non-empty `name` and no `disabled`, up to
  its end tag or the next `<form>`. `formFieldsOf` (in
  `Flow/RunStep.formFields.ts`) fails `<step> form field not hidden` when a
  field's `type` is not `hidden` (a missing `type` included), and
  `<step> form fields invalid` for a name off `FORM_FIELD_NAME`
  (`^[\w-]{1,100}$`), a `value` past 32 768 chars or with no `=`, a field
  count outside `minFields`..`maxFields`, a repeated name, a missing
  `required` name or any `forbidden` one. A field with no `value` reads `''`.
- The `{ name: value }` record, in page order, goes to carry `into`, and a
  form body sends it back through a [`$merge`](#jsonvaluetemplate). The slot
  is not an extract slot, so no extract rule may name it and `sessionCarry`
  cannot keep it. A failure names the step only, never a field or a value.

### Envelope codec

Some banks wrap every JSON request and answer in an AES-256-CBC envelope. A
POST step names it with `codec` (an `EnvelopeCodec`, N39). In `sealed` mode
(`IEnvelopeSealed`) the session key and the crypto session id come from carry:

```ts
codec: {
  kind: 'ecdh-aes-cbc',
  mode: 'sealed',
  keyRef: 'carry.envelopeKey',
  sessionRef: 'carry.envelopeSession',
},
```

- `keyRef` must name canonical base64 of 32 bytes and `sessionRef` a 1..512
  character id (`toSession`, in `Crypto/EnvelopeCodec.ts`); anything else
  fails `<step> envelope key invalid` before the request is sent.
- `sealGuardedBody` (in `Flow/RunStep.codec.ts`) seals the body last, after
  its signature and form guard. The hydrated body must be exactly
  `{ headers, data }`: at most 16 header records and a data record, or the
  step fails `<step> envelope body invalid`. `sealEnvelope` sends `headers`
  (one `encryption` record naming the `iv` and the `crypto_session_id`),
  `enc_headers` and `data`: each header and the data are sealed as UTF-8
  JSON, PKCS#7 padded, base64, under one fresh 16-byte IV.
- `openGuardedAnswer` opens the answer before its
  [bank-error guard](#bank-error-guard), outcome and extracts, which then read
  `{ headers, data }`: the answer's own headers and the opened data. So
  `/data/state` reads an opened field and `/headers/?type=session_id/...` an
  original header.
- `openEnvelope` (in `Crypto/EnvelopeCodec.open.ts`) opens only an answer
  sealed for this session. Its `headers` are at most 16 records,
  `enc_headers` is absent or empty, and exactly one `encryption` header names
  this session or none. Its IV is canonical base64 of 16 bytes, and its
  `data` canonical base64 of whole blocks, at most 4 194 304 characters, that
  decrypts to a strict UTF-8 JSON record. Anything else fails
  `<step> envelope invalid`.
- An answer must come back sealed (N52). A plaintext answer with a non-zero
  numeric `error_code` fails `<step> bank error`; any other plaintext answer
  fails `<step> envelope invalid`. Opened data with such an `error_code` fails
  `<step> bank error` too.
- Only the opened data's top-level keys are logged. A failure names the step
  only, never a key, an IV or plaintext.
- `toSession` returns an `IEnvelopeSession` (the key bytes and the id).
  `Crypto/EnvelopeWire.ts` holds what sealing and opening share: `CIPHER`
  (`aes-256-cbc`), `IV_BYTES` (16), `canonicalBytes` (base64 that re-encodes
  to the same text), `isJsonRecord`, `headerList` and `headersOfType`. Tests
  pass `sealEnvelopeWithIv` a fixed IV to match openssl goldens.

The key-exchange step that opens the session names the `exchange` mode
(`IEnvelopeExchange`). It reads the client scalar an
[`ecdh-key` generator](#carry-generators) wrote, and writes the session for
the `sealed` steps after it:

```ts
codec: {
  kind: 'ecdh-aes-cbc',
  mode: 'exchange',
  privateRef: 'carry.ecdhPrivate',
  keyInto: 'envelopeKey',
  sessionInto: 'envelopeSession',
},
```

- `privateRef` must name canonical base64 of a 32-byte secp256k1 scalar in
  the curve's range (`toExchangeKey`, in `Crypto/EnvelopeCodec.exchange.ts`);
  anything else fails `<step> envelope key invalid` before the request is
  sent. The body itself goes out as hydrated, not sealed.
- `exchangeSession` reads the answer's headers: exactly one `key_exchange`
  record with `scheme` 2, a `y` that is canonical base64 of a SEC1 point
  (65 bytes from 0x04, or 33 from 0x02 / 0x03) on the curve, and a
  `crypto_session_id` that `isSessionId` accepts (1..512 characters). The
  session key is the SHA-256 of the ECDH shared secret. Anything else fails
  `<step> envelope invalid`.
- The answer must open under that session, as in `sealed` mode (N52). Then
  the key (base64) goes to the `keyInto` slot and the id to `sessionInto`;
  the step's extracts read the opened answer and run after, so an extract
  into the same slot wins.
- `Flow/RunStep.codec.ts` holds one seal and one open per mode in
  `CODEC_MODES`, so a new mode is one row. `sealSealedBody` and
  `openSealedAnswer` live in `Flow/RunStep.codec.sealed.ts`;
  `checkExchangeKey` and `openExchangeAnswer` in
  `Flow/RunStep.codec.exchange.ts`. Both open through `openForStep` (in
  `Flow/RunStep.codec.open.ts`), which returns an `IOpenedAnswer` (the
  answer and its bundle) and fails opened data that `hasBankErrorCode`
  flags. `stepFail` prefixes a reason with the step name, and `KEY_INVALID`
  is the shared `envelope key invalid` reason.

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

### Carry generators

A step's `generate` list (`ICarryGenerator`, `GeneratorTypes.ts`, N25) makes
values the bank expects the device to own. The reducer runs
`generateStepCarry` (in `Flow/RunStep.generate.ts`) once the `runIf` guard
passes and before the pre-hook and body hydration. A skipped step generates
nothing, and so does a warm run that starts after it. The generators run in
order. Each one's slots merge into carry, so a later generator, the step's
body and later steps can read them. `GENERATOR_RUNS` maps each
`CarryGeneratorKind` to its runner:

| Kind         | Writes                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rsa-key`    | `generateRsaKey` (`IRsaKeyGenerator`): a fresh RSA key of `bits` (2048). Its PKCS#8 PEM goes to `keyInto`, and `spkiSha256Hex` of its public key (64 lowercase hex characters) to `spkiSha256HexInto` |
| `pkcs10-csr` | `generatePkcs10Csr` (`IPkcs10CsrGenerator`, `Flow/RunStep.generate.csr.ts`): a PKCS#10 request signed with the RSA key `keyRef` names, base64url DER without padding, to `into`                       |
| `ecdh-key`   | `generateEcdhKey` (`IEcdhKeyGenerator`, `Crypto/EcdhKeypair.ts`, N38): a fresh key pair on `curve` (`secp256k1`), base64. The uncompressed public point (65 bytes, 0x04 first) goes to `publicInto`   |

```ts
generate: [{ kind: 'rsa-key', bits: 2048, spkiSha256HexInto: 'deviceId' }],
```

A `pkcs10-csr` generator can sign with the key an `rsa-key` generator made
earlier in the same step. Each `subject` entry (`ICsrSubjectEntry`) pairs a
`CsrSubjectAttr` (`O`, `DC`, `OU` or `CN`) with a value template that
hydrates like a body value and must be text:

```ts
generate: [
  { kind: 'rsa-key', bits: 2048, keyInto: 'certKeyPem' },
  {
    kind: 'pkcs10-csr',
    keyRef: 'carry.certKeyPem',
    subject: [
      { attr: 'O', value: { $literal: 'Example Bank' } },
      { attr: 'CN', value: { $join: { parts: ['creds.num', { literal: '-' }, 'creds.id'] } } },
    ],
    into: 'csr',
  },
],
```

`buildCsr` (`Crypto/CsrBuilder.ts`) takes an `ICsrBuildInput`: the key PEM
and the hydrated subject as `ICsrSubjectValue` entries. It writes a v0
request: the subject, the key's SPKI and an empty attribute set `[0]`,
signed SHA1withRSA (`1.2.840.113549.1.1.5`). `csrSubjectDer`
(`Crypto/CsrSubject.ts`) keeps the RDNs in the given order. DC is an
IA5String and must be ASCII. O, OU and CN are a PrintableString when the
text fits that alphabet, else a UTF8String. The DER writers (`DER_TAGS`,
`DerTag`, `derNode`, `derSequence`) live in `Crypto/DerEncoding.ts`. A key
that is not text or not an RSA private key, a subject value that is not
text, or a DC that is not ASCII fails the generator.

An `ecdh-key` generator also writes its private scalar to `privateInto`:
`paddedPrivateKey` pads it back to 32 bytes, since `getPrivateKey` drops
leading zeros. The scalar is for this login's key exchange alone, so it may
not be a `sessionCarry` slot:

```ts
generate: [
  { kind: 'ecdh-key', curve: 'secp256k1', publicInto: 'ecdhPublic', privateInto: 'ecdhPrivate' },
],
```

A runner returns its slots as `GeneratedCarry`. A generator that fails or
rejects fails the step `<step> generate <kind> failed` before any request.
The message carries no generated material.

### Device certificate

A bank whose login obtains its device certificate at runtime declares a
dynamic `clientCert` on its headless block
([Dynamic client certificate](../architecture/pipeline.md#dynamic-client-certificate)).
The step that has the key and the issued certificate in scope names them in
its `clientCert` (`IStepClientCert`, N26): refs to the PEM private key and the
PEM certificate.

```ts
clientCert: { key: 'carry.certKeyPem', cert: 'carry.certPem' },
```

`prepareStepSession` (in `Flow/RunStep.session.ts`) runs before the step's
URL, body or headers resolve: it binds the step's client cookies, then
`installStepCert` (in `Flow/RunStep.clientCert.ts`) resolves both refs to text
with `resolveRefText` and installs the pair through the bus's `clientCert` port. The step's own request
already presents the certificate, and so does every later request to the
bank origin, scrape phase included. The step fails before any request:

- `<step> client certificate unsupported` when the bus has no certificate
  port (the bank declares no dynamic `clientCert`);
- `<step> client certificate invalid` when a ref is unresolved or not text,
  or the port refuses the pair (it does not parse, or the certificate does not
  certify the key). A refused pair keeps the certificate already installed.

Neither message carries key or certificate text. An `extractRules`
`pemCertificate` rule on the issuing step refuses an unusable certificate
before it reaches carry ([Extract rules](#extract-rules)).

### Session carry

Once the login succeeds, the ACTION stage installs the session context the
scrape phase reads (`getSessionContext`). By default that is the full carry
snapshot. A flow whose carry holds registration secrets (a device key, an
issued certificate, client credentials) names what the scrape may see in
`sessionCarry` (N32):

```ts
sessionCarry: ['mag'],
```

`projectSessionCarry` (in `SessionCarryProjection.ts`) is the only path from a
carry snapshot to `setSessionContext`. It keeps exactly the allowlisted slots
the carry holds and drops every other slot; without `sessionCarry` it passes
the full snapshot. Both installs go through it: `setBusAuth` after the first
prime, and the recovery hook (`makeRecoveryHook`) after every recovery.
`setSessionContext` replaces the previous context rather than merging into it,
so a recovery also drops every value the scrape patched in since. The token
strategy keeps the full carry privately for warm export and recovery.

Each slot must name a body or header extract of some login or resume step
(a [build-time check](#build-time-config-checks)), so a generated key or a
seeded credential can never be allowlisted.

### Cookie hand-off

A login on one gateway can leave cookies the scrape must not send: a `Path=/`
cookie scoped to the bank's registrable domain matches every later read on a
sibling host. `cookieHandoff` (a `CookieHandoff`, N35) decides what a finished
login leaves in the session jar:

- `shared` (the default) leaves the jar as the login left it.
- `isolate` moves the jar's cookies to the run's private stash
  (`ILongTermTokenSlot.handoffCookies`) and empties the jar, so the scrape
  starts from an empty jar and sends only cookies its own calls set.

`handOffCookies` (`Flow/CookieHandoff.ts`) runs in `finishFlow` after every
successful cold or warm login, right after the warm export, so a kept jar is
published in the next warm token before it is emptied. `isolate` needs a
domain jar (`headless.cookieDomains`, a
[build-time check](#build-time-config-checks)). Durable device auth
(`persistentAuth`) runs its own flows and never hands off. An in-run recovery
puts the stash back before it resumes; see [Auth recovery](#auth-recovery).

### OTP pre-hook guards

A step's `preHook` (`IPreStepHook`) asks the caller for a code. Three optional
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
},
```

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

### Session-transport fields

Some banks keep the session in cookies shared by sibling hosts, and answer
login calls with redirects, HTML pages or response headers instead of JSON
alone. Reading, encoding, headers and domain cookies work on either node
transport (`nativeFetch` or node:https with a certificate or TLS profile).
Step redirects and bank-wide redirect, status and failure-text defaults need
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
  extractsToCarry: {},        // no body extracts, outcome or bank-error guard
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
  `response: 'text'` reads the answer as `{ text }`, up to `maxTextChars`
  (65 536 by default), and `textCaptures` read slots off it
  ([Text captures](#text-captures)); `formCapture` reads a login form's
  hidden fields off it ([Login-form capture](#login-form-capture));
  `statusPolicy` decides a 2xx before any body is read
  ([Document responses and status policies](../architecture/pipeline.md#document-responses-and-status-policies)).
- `headerExtractsToCarry` reads a header of the final response; a missing
  header without `fallback` fails with `<step> header missing`
  ([Response-header carry](../architecture/pipeline.md#response-header-carry)).
- `deriveCarry` runs once the step's extracts are in scope
  ([Carry derivation](#carry-derivation)).
- `encoding: 'form'` sends the body as `application/x-www-form-urlencoded`,
  and `encoding: 'form-latin1'` the same over ISO-8859-1; either shape must be
  a flat record of `$ref`, `$join` and scalar `$literal` values, or one
  `$merge` whose `set` is such a record. `encoding: 'text'`
  sends the string of a `{ text }` body verbatim, with no content-type
  ([Form bodies](../architecture/pipeline.md#form-bodies)). `isFlatFormBody`
  guards the hydrated form step and both form writers against arrays and
  nested values.
- `seal` writes one credential, sealed under the bank's RSA modulus, at a
  body pointer; neither value reaches carry
  ([Sealed fields](../architecture/pipeline.md#sealed-fields)).
- `setCookies` writes client cookies, host-only with `Path=/` and `Secure`,
  before the step's request; `$ref: cookie.<name>` reads the cookie that
  applies to the step URL, URL-decoded
  ([Client cookies](../architecture/pipeline.md#client-cookies)).
- `clientCert` installs a device certificate the run obtained, presented to
  the bank origin from that step on ([Device certificate](#device-certificate)).
- `extractRules` checks a body or header extract's type, text, length, URL or
  certificate before it reaches carry ([Extract rules](#extract-rules)).
- `runIf` skips the step, pre-hook included, unless a carry slot holds one of
  the listed texts ([Conditional steps](#conditional-steps)).
- `generate` writes fresh device material, such as an RSA key, into carry
  before the body is hydrated ([Carry generators](#carry-generators)).
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
`IApiDirectRule` (a message and an `isBroken` check), `allSteps`, which
lists the login steps and any durable resume steps, `anyStep`, which breaks a
rule when any of those steps fails a check, and `isExtractSlot`, which
says whether a slot names one of a step's body, header or text-capture slots
(the last through `captureSlotsOf`, which skips `absent` guards). The
`API_DIRECT_OUTCOME_RULES` in `Core/Builder/ApiDirectStepRules.ts` reject empty
success lists and case-insensitive failure-map collisions before warm-start
checks. The
session-transport rules, `API_DIRECT_TRANSPORT_RULES` in
`Core/Builder/ApiDirectTransportRules.ts`, run after the core rules, then the form-body rules, `API_DIRECT_FORM_RULES` in
`Core/Builder/ApiDirectFormRules.ts`, which end with the `$merge` rules,
`API_DIRECT_MERGE_RULES` in `Core/Builder/ApiDirectMergeRules.ts`, then the seal rules,
`API_DIRECT_SEAL_RULES` in `Core/Builder/ApiDirectSealRules.ts`, then the
step rules, `API_DIRECT_STEP_RULES` in `Core/Builder/ApiDirectStepRules.ts`,
then the text-capture rules, `API_DIRECT_TEXT_RULES` in
`Core/Builder/ApiDirectTextRules.ts`, which end with the login-form capture
rules, `API_DIRECT_FORM_CAPTURE_RULES` in
`Core/Builder/ApiDirectFormCaptureRules.ts`,
then the carry-generator rules, `API_DIRECT_GENERATE_RULES` in
`Core/Builder/ApiDirectGenerateRules.ts`, which end with the envelope codec
rules, `API_DIRECT_CODEC_RULES` in `Core/Builder/ApiDirectCodecRules.ts`,
and the step URL rules, `API_DIRECT_URL_RULES` in
`Core/Builder/ApiDirectUrlRules.ts`,
then the dynamic client-certificate
rules, `API_DIRECT_CLIENT_CERT_RULES` in
`Core/Builder/ApiDirectClientCertRules.ts`, then the session rules,
`API_DIRECT_SESSION_RULES` in `Core/Builder/ApiDirectSessionRules.ts`. The
transport rules, `API_DIRECT_NATIVE_RULES` in
`Core/Builder/ApiDirectNativeRules.ts`, run last: step reading and domain
cookies are rejected off either node transport; redirects and native-only
bank defaults are rejected on node:https too. `NATIVE_HEADLESS_FIELDS` names
the native-only defaults checked by both api-direct and node-tls builders.
The first broken rule
fails the build with `Generic` and `<field>: <rule>`:

| Broken when                                                                                                                               | Message                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `authScheme: 'prefixed'` with a missing or blank `authPrefix`                                                                             | `authPrefix: required when authScheme is prefixed`                                 |
| `authScheme: 'none'` without `headless.sessionCookies: true`                                                                              | `headless.sessionCookies: required when authScheme is none`                        |
| `headless.sessionCookies` and any login or resume step with `cookieJar`                                                                   | `steps.cookieJar: not allowed with headless.sessionCookies`                        |
| any login or resume step whose `outcome.successCodes` is empty                                                                            | `outcome.successCodes: must not be empty`                                          |
| `warmStart` validated as `'jwt'` (the default) with no `jwtClaims`                                                                        | `jwtClaims: required when warmStart.validation is jwt`                             |
| `warmStart` validated as `'bank-call'` with a `fromStepIndex` that names no step                                                          | `warmStart.fromStepIndex: must name a step when validation is bank-call`           |
| `warmStart.fromStepIndex` below 1                                                                                                         | `warmStart.fromStepIndex: must start after the first step`                         |
| `warmStart.fromStepIndex` fractional, `NaN` or above `steps.length`                                                                       | `warmStart.fromStepIndex: must be a whole number up to the step count`             |
| `warmStart` validated as `'bank-call'` whose `fromStepIndex` step has a `runIf` guard                                                     | `warmStart.fromStepIndex: a bank-call check step must not have runIf`              |
| a `kind: 'cookie-jar'` or `'carry-bundle'` `warmStart` with a blank `provider`                                                            | `warmStart.provider: must not be blank`                                            |
| a `kind: 'cookie-jar'` `warmStart` with a blank `accountField`                                                                            | `warmStart.accountField: must not be blank`                                        |
| a `kind: 'cookie-jar'` or `'carry-bundle'` `warmStart` whose `maxTokenChars` is not an integer from 1 to 16384                            | `warmStart.maxTokenChars: must be an integer from 1 to 16384`                      |
| a `kind: 'cookie-jar'` `warmStart` without `headless.cookieDomains`                                                                       | `warmStart.kind: cookie-jar not allowed without headless.cookieDomains`            |
| a `kind: 'carry-bundle'` `warmStart` with no `accountFields`, or a blank one (`API_DIRECT_WARM_BUNDLE_RULES`)                             | `warmStart.accountFields: must name a creds field, none blank`                     |
| a `kind: 'carry-bundle'` `warmStart` with an empty `slots`                                                                                | `warmStart.slots: must not be empty`                                               |
| a `kind: 'carry-bundle'` `warmStart` keeping a slot no login step extracts or generates                                                   | `warmStart.slots: each slot must be filled by a login step`                        |
| a `kind: 'carry-bundle'` `warmStart` with `cookies: true`, without `headless.cookieDomains`                                               | `warmStart.cookies: not allowed without headless.cookieDomains`                    |
| a `response: 'document'` step with any `extractsToCarry`, `optionalExtractsToCarry`, `outcome` or nonempty `failIfPresent`                | `steps.response: a document step reads no body extracts, outcome or failIfPresent` |
| a `documentMarker` on any step whose `response` is not `'document'`                                                                       | `steps.documentMarker: only on a document step`                                    |
| a manual `redirect` on a step whose `method` is not `GET`                                                                                 | `steps.redirect: manual only on GET steps`                                         |
| a manual `headless.redirectPolicy` (the default every POST shares)                                                                        | `headless.redirectPolicy: manual only on GET steps`                                |
| a manual `redirect` whose `allow` list is empty                                                                                           | `redirect.allow: must not be empty`                                                |
| a manual `redirect` whose `maxHops` is not an integer from 1 to 10                                                                        | `redirect.maxHops: must be an integer from 1 to 10`                                |
| a manual `redirect` on any step while `headless.redirectPolicy` is not `'reject'`                                                         | `headless.redirectPolicy: must be reject when a step redirects manually`           |
| a form step (`form` or `form-latin1`) whose body shape is not a flat record of `$ref`, `$join` and scalar `$literal` values               | `steps.body: a form body must be a flat record`                                    |
| a `text` step whose body shape is not exactly `{ text }`                                                                                  | `steps.body: a text body must be exactly { text }`                                 |
| a form step whose whole-shape `$merge` (`isMergeRoot`) has a `base` off `carry.<slot>` or a `set` that is not flat                    | `steps.body: a form body must be a flat record`                          |
| a `$merge` anywhere but a form body's whole shape: a JSON or text body, a field, a header, a query (`API_DIRECT_MERGE_RULES`)         | `steps: $merge belongs only at the root of a form body`                  |
| a `seal` whose `kind` is not a `SealKind`                                                                                                 | `steps.seal.kind: unknown seal kind`                                               |
| a `seal` on a step that is not a `POST` with a record body                                                                                | `steps.seal: needs a POST step with a record body`                                 |
| a `seal` whose `writeTo` is not a JSON pointer                                                                                            | `steps.seal.writeTo: must be a JSON pointer`                                       |
| a `seal` whose `params` are out of range (exponent, seed, block size or printable text)                                                   | `steps.seal.params: out of range`                                                  |
| a login or resume step with a `failIfPresent` entry that is not a JSON pointer below the body root                                        | `steps.failIfPresent: each entry must be a JSON pointer`                           |
| an `extractRules` key that names no `extractsToCarry`, `optionalExtractsToCarry`, `headerExtractsToCarry` or `textCaptures` slot              | `steps.extractRules: each key must name a body or header extract`                  |
| an `extractRules` `pattern` that does not start with `^`, end with `$` and compile with the `u` flag                                      | `steps.extractRules.pattern: must be an anchored regex`                            |
| an `extractRules` `pattern` with a group, an alternation or a variable repeat before its last atom                                        | `steps.extractRules.pattern: must be a flat regex`                                 |
| an `extractRules` `maxChars` that is not an integer from 1 to 65536                                                                       | `steps.extractRules.maxChars: must be an integer from 1 to 65536`                  |
| an `extractRules` `oneOf` or `url` list that is empty                                                                                     | `steps.extractRules: oneOf and url must not be empty`                              |
| a login or resume step whose `runIf` has a blank `carry` or an empty `oneOf`                                                              | `steps.runIf: carry and oneOf must not be empty`                                   |
| a login or resume step with `textCaptures` whose `response` is not `'text'` (`API_DIRECT_TEXT_RULES`)                                    | `steps.textCaptures: need a text response`                                         |
| a login or resume step with `maxTextChars` whose `response` is not `'text'`                                                           | `steps.maxTextChars: needs a text response`                              |
| a `maxTextChars` that is not an integer from 1 to 2097152                                                                             | `steps.maxTextChars: must be an integer from 1 to 2097152`               |
| a `textCaptures` `pattern` that does not compile with the `g` flag                                                                    | `steps.textCaptures.pattern: must compile`                               |
| a `textCaptures` `pattern` with a group followed by `*`, `+` or `{`                                                                   | `steps.textCaptures.pattern: must not repeat a group`                    |
| a `textCaptures` `group` that is not an integer from 0 to its pattern's group count                                                   | `steps.textCaptures.group: must name a group of its pattern`             |
| a login or resume step with `formCapture` whose `response` is not `'text'` (`API_DIRECT_FORM_CAPTURE_RULES`)                          | `steps.formCapture: needs a text response`                               |
| a `formCapture` with an empty `form` or `into`                                                                                        | `steps.formCapture: form and into must not be empty`                     |
| a `formCapture` `action` that is not an absolute https URL written as `new URL(action).href`                                          | `steps.formCapture.action: must be an absolute https URL`                |
| a `formCapture` whose `minFields` or `maxFields` is not an integer, or not `1 <= minFields <= maxFields`                              | `steps.formCapture: needs integers 1 <= minFields <= maxFields`          |
| a `formCapture` `required` or `forbidden` name off `FORM_FIELD_NAME`, or named in both                                                | `steps.formCapture: field names must be valid and disjoint`              |
| a login or resume step with an `rsa-key` generator that names neither `keyInto` nor `spkiSha256HexInto` (`API_DIRECT_GENERATE_RULES`)     | `steps.generate: rsa-key needs keyInto or spkiSha256HexInto`                       |
| a login or resume step with a `pkcs10-csr` generator whose `subject` is empty or whose `into` is blank                                    | `steps.generate: pkcs10-csr needs a subject and into`                              |
| a login or resume step with an `ecdh-key` generator whose `publicInto` or `privateInto` is blank, or both name one slot               | `steps.generate: ecdh-key needs distinct publicInto and privateInto`     |
| a `sessionCarry` slot that is the `privateInto` of some `ecdh-key` generator                                                          | `steps.generate: ecdh-key privateInto must not be a sessionCarry slot`   |
| a login or resume step whose `preHook.valuePattern` does not start with `^`, end with `$` and compile with the `u` flag                   | `steps.preHook.valuePattern: must be an anchored regex`                            |
| a login or resume step whose `preHook.valuePattern` has a group, an alternation or a variable repeat before its last atom                 | `steps.preHook.valuePattern: must be a flat regex`                                 |
| a login or resume step with `clientCert`, without a `headless.clientCert` block (`API_DIRECT_CLIENT_CERT_RULES`)                          | `steps.clientCert: not allowed without headless.clientCert`                        |
| a `headless.clientCert` whose `origin` is not exactly `https://host[:port]` (no path, user, trailing slash or default port)               | `headless.clientCert.origin: must be an exact https origin`                        |
| `headless.clientCert` together with `headless.requiresClientCert: true`                                                                   | `headless.clientCert: not allowed with headless.requiresClientCert`                |
| a `sessionCarry` slot that names no body or header extract of any login or resume step (`API_DIRECT_SESSION_RULES`)                       | `sessionCarry: each slot must name a step extract`                                 |
| `cookieHandoff: 'isolate'` without `headless.cookieDomains`                                                                               | `cookieHandoff: isolate not allowed without headless.cookieDomains`                |
| a login or resume step with `response`, `documentMarker`, `headerExtractsToCarry` or `encoding` off native fetch and node:https           | `steps.<field>: not allowed without nativeFetch or node:https`                     |
| a login or resume step with `redirect`, without `headless.nativeFetch: true`                                                              | `steps.redirect: not allowed without headless.nativeFetch`                         |
| `headless.cookieDomains` off native fetch and node:https                                                                                  | `headless.cookieDomains: not allowed without nativeFetch or node:https`            |
| `headless.redirectPolicy`, `statusPolicy` or `omitBankText` without `headless.nativeFetch: true`, including node-tls banks                | `headless.<field>: not allowed without headless.nativeFetch`                       |
| `headless.cookieDomains` without `headless.sessionCookies: true`                                                                          | `headless.cookieDomains: not allowed without headless.sessionCookies`              |
| a `headerExtractsToCarry` header name that is not an HTTP token (RFC 9110)                                                                | `headerExtractsToCarry.header: must be an HTTP header name`                        |
| a login or resume step with `setCookies`, without `headless.cookieDomains`                                                                | `steps.setCookies: not allowed without headless.cookieDomains`                     |
| a `setCookies` cookie name that is not an HTTP token (RFC 9110)                                                                           | `steps.setCookies: each name must be an HTTP token`                                |
| a `seedCarryFromCreds` entry whose `random-hex` bootstrap draws a `bytes` count that is not an integer from 1 to 64                   | `seedCarryFromCreds: random-hex needs integer bytes from 1 to 64`        |
| a login or resume step with `codec` whose `encoding` or `response` is not `'json'` (`API_DIRECT_CODEC_RULES`)                         | `steps.codec: needs a json body and a json response`                     |
| an `exchange` codec whose `keyInto` or `sessionInto` is blank, or both name one slot                                                  | `steps.codec: exchange needs distinct keyInto and sessionInto`           |
| a `sessionCarry` slot that a codec reads or writes: the `privateRef`, `keyRef` or `sessionRef` slot, `keyInto` or `sessionInto`       | `steps.codec: codec slots must not be sessionCarry slots`                |
| a login or resume step with both `rawQuery` and `queryTemplate` (`API_DIRECT_URL_RULES`)                                              | `steps.rawQuery: not with queryTemplate`                                 |
| a `urlFromCarry` slot that no earlier step of the same list (login or resume) checks with an `extractRules` `url` rule                | `steps.urlFromCarry: slot needs an earlier url rule`                     |

`warmStart.validation` says how a stored token is judged before reuse. `'jwt'`
reads its expiry through `jwtClaims`. `'bank-call'` is for a token with no
readable expiry, so the first warm step sent to the bank is the check.
`fromStepIndex` must name a step with no `runIf`, so the check always runs.
A `'bank-call'` seed skips the local JWT
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

A config `pattern` or `valuePattern` is tested against bank and caller text, so
the build accepts only a flat regex, which matches in linear time.
`isFlatPattern` (`Core/Builder/FlatPattern.ts`) reads the source between `^`
and `$` as a run of atoms — a literal, `.`, an escape or a character class —
each with an optional quantifier. A group, a lookaround or an alternation
fails, and only the last atom may repeat a variable amount (`*`, `+`, `?` or a
range); every earlier quantifier must be an exact `{n}`. So `^\d{1,4}$`,
`^.{1,64}$` and `^\d{3}-\d{2,4}$` pass, while `(a+)+`, `^a*a*b$`, `^\w+!$` and
`^.*a{20000}$` fail. The earlier atoms then match one way, and each count the
last atom backs off to costs only the `$` check, so a failed match is linear in
the input.

A `textCaptures` pattern cannot be flat, since it takes a group. The build
still refuses a repeated group — `(…)` followed by `*`, `+` or `{`, the shape
of `(a+)+` — once escapes and character classes are stripped. That stops the
worst catastrophic backtracking, not every slow pattern, so capture patterns
stay reviewed config.

`warmStart.kind` says what the stored token is. The default, `'carry'`, seeds
it into the carry slot `carryField`. `'cookie-jar'` is for a cookie-session
bank with no bearer to replay: the token is the session jar itself
([Cookie-jar warm start](#cookie-jar-warm-start)). `'carry-bundle'` is for a
bank whose warm login needs several slots a cold login filled, and optionally
the jar ([Carry-bundle warm start](#carry-bundle-warm-start)).
The warm-start canary (`WarmStartContract`) follows the same policy. It
requires `jwtClaims` only for `'jwt'` validation, and it requires the warm path
to end holding a `token` only when the auth scheme sends a header (`none`
does not). It requires a login step to produce the stored token only when the
token is a carry slot; a cookie-jar token is the session jar itself.
Conflicting transport flags in the headless block are a separate check
(`assertSingleTransport`), run when the headless mediator is wired.

### Cookie-jar warm start

A `kind: 'cookie-jar'` warm start (`ICookieJarWarmStart`) is always validated
as `'bank-call'`, and adds `provider`, `accountField` and `maxTokenChars`.
`Flow/WarmStartKind.ts` reads the kind: `cookieJarWarmOf` returns the
cookie-jar config or `false`, and `warmCarryField` returns the carry slot, or
`''` when there is none to seed.
`encodeWarmJar` in `Flow/WarmCookieJar.ts` encodes a `StoredJar` as `v1.` plus
unpadded base64url over the JSON `{p, a, c}`: the provider tag, the first 16
hex characters of the SHA-256 of the trimmed account (never the account
itself), and the cookies in creation order. Only the cookie's own fields
travel. `decodeWarmJar` opens it, refusing with a reason from
`WARM_JAR_REJECTIONS` and never a value. Both refuse a blank account
(`unbound`), since it binds nothing; the build already refuses a blank
`provider` or `accountField`.
The provider tag and account hash only stop one account's jar from being
replayed for another. They are not authentication: like every stored warm
token, the jar is a secret its caller keeps.

`Flow/TokenStrategyFromConfig.warm.ts` runs the kind at three moments, through
the kind's restore, `resetCold` and publish ops (`TokenStrategyFromConfig.jar.ts`
for this kind):

- **Restore** (`restoreWarmSeed`). The stored token is checked in order —
  an account to bind, size, prefix, JSON, shape, provider, account — then imported into the run's
  cookie session, and the flow resumes at `fromStepIndex`. A token failing any
  check, or a run with no cookie session, is skipped with the warning
  `warm start skipped: <reason>`, naming the creds field and never the token,
  and the cold login runs.
- **Cold start** (`prepareColdStart`). Before a cold flow starts — after the
  one-SMS budget allows it — the jar is emptied, so neither a refused token
  nor the cookies its rejected resume set reach the fresh session.
- **Export** (`exportWarmToken`). A finished flow encodes the jar as the next
  warm token, so `onAuthFlowComplete` and `persistentOtpToken` receive the
  envelope. A token longer than `maxTokenChars`, or one for a blank account,
  is not published: the warning `warm start export skipped: <reason>` names
  the creds field and the reason only (with the length, when too long).

### Carry-bundle warm start

A `kind: 'carry-bundle'` warm start (`ICarryBundleWarmStart`) is always
validated as `'bank-call'`. It keeps the listed carry `slots` a cold login
filled — a body extract or a generator output of a login step — and, with
`cookies: true`, the session jar too. It adds `provider`, `accountFields` (the
creds fields the token is bound to, in order), `slots`, `maxTokenChars`,
`cookies` and `coldFallback`. `carryBundleWarmOf` (`Flow/WarmStartKind.ts`) returns the config or
`false`.
`encodeWarmBundle` in `Flow/WarmCarryBundle.ts` encodes `v1.` plus unpadded
base64url over the JSON `{p, a, s, c?}`: the provider tag, the first 16 hex
characters of the SHA-256 of the JSON array of trimmed account values (never
the values), the kept slots, and — only when the config keeps the jar — the
cookies. `decodeWarmBundle` checks in order — an account to bind, size,
prefix, canonical base64url, JSON, shape, provider, account, slots (exactly
the config's, each non-empty text), then the jar (present exactly when the
config keeps it, each cookie well-typed) — and refuses with a reason from
`WARM_BUNDLE_REJECTIONS`, never a value. Every account value must be
non-blank (`unbound`). `decodeWarmBundle` returns an `IWarmBundle`: the `BundleCarry` slots and the jar, or `false` when the config keeps none. The parts both codecs share live in `Flow/WarmTokenParts.ts`: `WARM_TOKEN_PREFIX`, `identityTag` (the 16-hex SHA-256 tag), `wrapJsonText` and `parseJsonBody` for the body, `isRecordValue`, `isListValue`, `isStoredCookie` and `projectCookie` for the shape and cookies, and `textAt` for a slot's text. The cookie-jar hash is unchanged, so stored jar tokens still open.

Each kind's ops take an `IWarmRunArgs` (config, bus and creds) and restore a `WarmCarry` starting carry: `restoreJar` and `exportJar` (`TokenStrategyFromConfig.jar.ts`), and `restoreBundle` and `exportBundle` (`TokenStrategyFromConfig.bundle.ts`). Both skip a token through `skipWarmRestore` and publish through `publishWithin`, which applies `maxTokenChars`. The build rules read either bound kind through `boundWarmOf`, which returns a `BoundWarmStart` (a cookie-jar or carry-bundle config) or `false`, and check cookie domains through `hasCookieDomains` (`Core/Builder/ApiDirectRuleInput.ts`).

The bundle's ops:

- **Restore.** A token that opens has its jar imported into the run's cookie
  session, when it keeps one, and its slots become the starting carry; the
  flow resumes at `fromStepIndex`. A refused token, or a jar for a run with no
  cookie session, is skipped with the warning `warm start skipped: <reason>`,
  and the cold login runs.
- **Cold start.** Before a cold flow's step 0 — after the one-SMS budget
  allows it — the jar is emptied and the client cert an earlier login
  installed is dropped through the bus's `clientCert` port, so a rejected
  resume leaves nothing behind. The restored slots need no reset: only a warm
  resume is handed them. The carry kind's `resetCold` resets nothing.
- **Cold fallback** (`coldFallback`, a `ColdFallback`). When the warm resume
  fails, `TokenResolverBuilder` asks the strategy's optional
  `mayEscalateWarmFailure` whether to run the cold login — after its own
  checks, so an edge block or missing warm state never asks.
  `mayEscalateWarmFailureImpl` (`TokenStrategyFromConfig.fallback.ts`)
  answers from the config: `'any'` lets every failure escalate, as every
  other kind does; `'auth-rejected'` lets only a 401/403 the bank answered,
  so a timeout, a 5xx or a 400 returns the warm failure and never starts a
  registration. `isAuthRejectedFailure` (`Api/ApiMediator.authReject.ts`)
  reads both the transport's `401:` marker and the `HTTP 401` a login step is
  sanitised to, and never an edge block; `isAuthRejectionMessage` is
  unchanged. A token refused locally never asks: it runs cold at once.
- **Export.** A finished flow reads each kept slot from its carry, and the jar
  when kept, and encodes them as the next warm token. A slot left unfilled, an
  unbound account or a token longer than `maxTokenChars` publishes nothing:
  the warning `warm start export skipped: <reason>` names the creds field and
  the reason only. The export reads the full carry; the `sessionCarry`
  allowlist applies afterwards, to what the scrape is handed.

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
original space-delimited `<status>:` marker. Scrape-phase requests keep the transport
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

| Kind       | Values                                                                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step names | `bind`, `login`, `assertPassword`, `assertOtp`, `getIdToken`, `sessionToken`, `prime`, `validate`, `deviceKey`, `register`, `resume`, `bootstrap`, `landing`, `logon`, `encryptionKey`, `identify`, `verify`, `otpInit`, `otpVerify`         |
| Auth tags  | `auth.bind`, `auth.login`, `auth.assert`, `auth.logout`, `auth.prime`, `auth.resume`, `auth.service`, `auth.bootstrap`, `auth.landing`, `auth.logon`, `auth.encryptionKey`, `auth.identify`, `auth.verify`, `auth.otpInit`, `auth.otpVerify` |

`identity.*` and `data.*` tags work the same way.

### Password-only chains

A bank that logs in with credentials alone still declares `flow: 'sms-otp'`,
the only flow kind `gateFlowKind` accepts. The flow asks for a code only
through a step's `preHook`. For a step with no `preHook`, `resolveStepScope`
(`Flow/SmsOtpFlow.reduce.ts`) leaves the scope unchanged and the step still
sends its request; otherwise `applyGuardedPreHook` runs its
[guards](#otp-pre-hook-guards) around `applyPreHook`, which calls the creds
function named by `awaitCredsField`. A chain with no `preHook` on any step
therefore never prompts, even when the caller passes `otpCodeRetriever`.

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
see [Session recovery](api-direct-scrape.md#session-recovery).

`recoverSession` re-grants the session rather than logging in again when the
strategy can. It calls the resolver's optional `recover()`, which
`TokenResolverBuilder` binds to the strategy's optional `primeRecover`. A
resolver without one runs `refresh()` (`primeFresh`), as before. Both share the
`isRefreshing` re-entrancy guard in `guardedMintOp`. A 401 or 403 inside one
call still runs `refresh()` through `retryOn401Op`.

The config strategy's `primeRecover` is `primeRecoverImpl`
(`Flow/TokenStrategyFromConfig.recover.ts`). It picks its route from
`RECOVER_ROUTES` by warm kind, so a new kind names its own. A `carry-bundle`
login resumes: the [cookie hand-off](#cookie-hand-off) stash goes back into an
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
| `INVALID_OTP`                                                   | Wrong code, or a code that fails its pre-hook `valuePattern` (`<step> preHook value invalid`) — see [OTP pre-hook guards](#otp-pre-hook-guards)                                                                                                                                           |
| `TWO_FACTOR_RETRIEVER_MISSING`                                  | OTP step reached without callback (`preHook: creds.<field> is not a function`)                                                                                                                                                                                                            |
| `GENERIC`                                                       | A pre-hook `requires` ref did not resolve, or the OTP callback threw (`preHook: creds.<field>() threw <ErrorName>`) — see [OTP pre-hook guards](#otp-pre-hook-guards)                                                                                                                     |
| `INVALID_PHONE_NUMBER`                                          | `phoneNumber` cannot be normalised to the bank's wire format — see [Phone normaliser](#phone-normaliser)                                                                                                                                                                                  |
| `TIMEOUT`                                                       | A step's HTTP call didn't complete (`<step> TIMEOUT`)                                                                                                                                                                                                                                     |
| `GENERIC`                                                       | A step's HTTP call failed: `<step> HTTP <status>` for a non-2xx reply, `<step> GENERIC` for a network error — see [Transport errors](#transport-errors)                                                                                                                                   |
| `GENERIC`                                                       | Signer key missing, response shape drift, a `cryptoField` failure, or a second cold login refused by the [one-SMS budget](#one-sms-per-run)                                                                                                                                               |
| `GENERIC`                                                       | `persistent auth options invalid: <category>`, `persistent auth state invalid: <category>` or `persistent auth failed: <category>` — a [durable device auth](#persistent-durable-device-auth) failure; the categories are listed in [Pepper](../banks/pepper.md#failures-never-fall-back) |
