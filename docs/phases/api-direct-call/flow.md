# API-DIRECT-CALL — Flow

How one step is built and carried: queries, URLs, extracts, credentials and generated carry values.

## Carry derivation

- `seedCarryFromCreds` mirrors creds into carry slots at flow init.
- `sha256-prefix-16` derives a stable identifier from another creds field (PayBox uses this to bind its long-term JWT to a phone-derived `deviceId16Hex` — warm-start-stable without the caller persisting state).
- `random-uuid` generates one canonical UUID per flow init, so every step that reads the slot sees the same value — for banks that need a stable client-instance identifier across the steps of one login. A non-empty creds value is mirrored instead.
- `random-hex` (`IRandomHexBootstrap`) draws `bytes` (1 to 64) fresh random bytes per flow init as hex, twice as many characters, upper-case when `isUpperCase` is set — for a flow identifier of a fixed length and case. `evalRandomBootstrap` (in `Flow/FlowInitCarry.random.ts`) serves it and the other `RandomBootstrap` kinds, `random-hex-16` and `random-uuid`, once `isRandomBootstrap` matches; a non-empty creds value is mirrored instead.
- A seed with `alwaysBootstrap: true` must name one of those random bootstraps and draws a new value at every flow init, regardless of credentials or initial carry. Without this option, existing credential-first behavior is unchanged.
- `derivedCarry` joins parts with separators + truncation for OTP-encryption keys. `transform: 'lower'` lower-cases the joined text before the byte cap, so a slot can carry a lower-cased copy of a credential (the FIBI Transmit `uid`) while the credential itself stays as typed.
- A step's `deriveCarry` takes the same `IDerivedCarry` entries and runs them once that step's body and header extracts are in scope. `deriveStepCarry` hands them to `applyDerivations`, the evaluator flow-init `derivedCarry` uses, so the parts (`carry.<slot>`, `creds.<field>`, `config.<dotted.path>` such as `config.secrets.<name>`), separator, truncation and failure messages (`derivedCarry: carry.<slot> missing or non-string`) are the same. A part that fails fails the step.
- `op` (`DerivedOp`) shapes the finished text last, after the join, `transform` and the byte cap: `applyDerivedOp` (in `Flow/FlowInitCarry.ops.ts`) takes an `IOpInput`: the text, the subject a failure names and the op. A `format` op (`IFormatOp`) takes the first `IFormatRule` whose `pattern` matches the whole text, anchored at both ends with the `u` flag by `anchoredPattern`, and writes the rule's `prefix` plus the text left-padded with `0` to `padStart` chars, so a 1-to-9-digit id can become `00001` and nine digits. No match fails `Generic`, naming the slot and never the text: `derivedCarry: <slot> unformattable` at flow init, `<step> derive <slot> unformattable` in a step, before that flow's next request. An `md5-hex` op (`IMd5HexOp`) writes the MD5 digest of the UTF-8 text as lower-case hex, for a bank that checks one; nothing relies on it for secrecy.
  Format patterns use the linear-time `FlatPattern` grammar: no groups or
  alternation, and a variable repeat only on the last atom. Explicit anchors
  are optional because the evaluator adds them.
- A `url-query` op (`IUrlQueryOp`) reads exactly one nonempty value of its
  configured `key` from one URL source part. `queryValue` applies `isQueryKey`
  and `isQueryText` to reject unsafe keys and values; `hasValidEncoding`
  rejects malformed query escapes. `MAX_QUERY_URL_CHARS` caps the source URL
  at 32,768 characters and `MAX_QUERY_VALUE_CHARS` caps decoded values at
  8,192. Invalid URLs or encoding,
  missing or duplicate values, control characters and ill-formed Unicode fail without naming
  the URL or value. `rejectBlank: true` additionally refuses whitespace-only
  decoded values without trimming accepted values; omitting it preserves the
  existing behavior.
- A `url-path-map` op (`IUrlPathMapOp`) takes one untransformed, untruncated URL source and
  chooses a static path by a single query value. Both the source and mapped
  destination must match their own nonempty HTTPS URL-rule allowlists. The
  complete query is retained; missing, duplicate, malformed or unsupported
  selectors and unsafe URLs fail without exposing their values. The builder
  validates the map, selector and both policies before a flow starts.
- A `url-compose` op (`IUrlComposeOp`) uses `runUrlCompose` to resolve one absolute or relative target
  against a configured HTTPS origin. It checks the input and final URL against
  separate allowlists and may set a static canonical path. With an `IUrlComposeMerge` policy,
  three parts supply the target, an independently allowlisted fresh source URL
  and a nonblank identity. Required source query keys must each occur once;
  source keys replace target keys, then the identity replaces `setKey`. Other
  target query fields remain. URL/query bounds, lossless UTF-8 encoding and control checks
  apply before use, and the final carried GET checks the destination again.
  Composition does not admit separators, transforms or truncation.

## Raw query

Some banks read a query byte for byte, so a percent-encoded `queryTemplate`
pair would not match what they expect. Such a step sets `rawQuery`, an
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
query once, so the canonical `pathAndQuery` and the bus target use the same
generated values. It reads an `IStepUrlInput`: the step, its scope and its
company. `sendTargetOf` gives the bus that resolved URL as a literal, so the
transport sends it unchanged; `ITokenBus` takes a `WKUrlOrLiteral`. A step
with neither a raw query nor a carried URL (below) still goes to the bus as
its WK tag.

## Carried step URL

Some banks hand the client the next URL to call, as a redirect target or as a
field in an answer. A GET step sends there when it names `urlFromCarry`,
the carry slot holding that URL. Its `urlTag` still names the step but is not
sent to. A POST cannot name it, since `IPostStep.urlFromCarry` is `never`.

The slot must hold an absolute URL. Every earlier step that may write it in
the same list (login or resume) must check it with an `extractRules` `url`
rule, as its [final URL](#final-url-carry) under its manual redirect rules,
or as the URL its [handoff script](captures.md#handoff-script-capture) sets under its
capture rules, or as an [SDK reference](captures.md#sdk-reference-capture) checked by its
capture rules, or as a checked `url-path-map` destination. This includes
optional fallbacks and conditional writers;
an unchecked overwrite or a pre-hook writing the consumer's URL fails the
build with `steps.urlFromCarry: slot needs an earlier url rule`. An absent
optional extract after a pre-hook write still checks that write against its
own rule. At run time, the actual carried URL must also match an earlier
producer's rules. A missing, non-text, relative or unapproved URL fails with
`<step> carried url invalid` before the GET is sent.
`allowedRulesOf` reads each writer's extract, final-URL, handoff, SDK and
path-map destination rules;
`carriedUrlRulesOf` gathers preceding writers' rules for the consumer's
pre-hook and dispatch checks.

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

## Final URL carry

A bank may hand the client a ticket URL that redirects to the page later calls
must name, for example as their `Referer`. A GET step with a manual `redirect`
can carry that page's URL: `finalUrlInto` names the slot that takes the
URL that gave the final answer, after the last hop. A POST cannot name it,
since `IPostStep.finalUrlInto` is `never`.

The native transport hands the step's header sink each answer's URL, and the
step's capture keeps only the last one, so a call retried after a 401 carries
its final answer's URL. `carryFinalUrl` (`Flow/RunStep.finalUrl.ts`) then
checks that URL against the step's own `redirect.allow` rules. Every hop
already passed them, so in practice only a request URL that answered without
a hop is refused: the step fails `Generic` with `<step> final url refused`,
naming no URL. The URL is never logged. A later step reads the slot like any
carry slot, in a header template or as its `urlFromCarry`.

```ts
{
  name: 'landing',
  urlTag: 'auth.bind',
  method: 'GET',
  urlFromCarry: 'handoffUrl',
  extractsToCarry: {},
  redirect: {
    maxHops: 3,
    allow: [{ origin: 'https://bank.example', paths: ['/portal/landing'] }],
  },
  finalUrlInto: 'landingUrl',
}
```

The build refuses a `finalUrlInto` on a step without a manual `redirect`, whose
rules would check it, and one that is blank or names a slot the step also
extracts. A manual `redirect` itself needs `transport.nativeFetch` and
`transport.redirectPolicy: 'reject'`.

## Optional extracts

`extractsToCarry` fails the step when a field is missing. For fields that only
some responses carry, use `optionalExtractsToCarry`, a map of carry slot to
`IOptionalExtract` (`pointer`, optional `fallback`). It is read after the
required extracts and is applied by `extractOptional` in
`Flow/RunStep.optional.ts`:

- When the pointer resolves to a string that is not blank, that string is
  written as it is.
- Otherwise, when `fallback` is set, the fallback is written.
- Otherwise the slot keeps the value an earlier step stored.

For carry writing, an empty or whitespace-only string, a number, `null` or
an object count as missing, so a blank field never overwrites a live value.
For a ruled optional slot, `optionalRawValue` retains a present, nonblank
raw value for `extractRules` before using any fallback; an invalid value is
refused rather than hidden.

`keepExisting: true` keeps a value carry already holds. The slot is
written only while carry has no non-empty string for it, so a device id an
earlier run seeded survives a different id in the answer. When the answer
differs, the debug log notes `{step, slot, kept: true}` and never the values.
An `extractRules` entry on a kept slot is skipped. Without the flag, a present
value still overwrites. `API_DIRECT_OPTIONAL_EXTRACT_RULES` rejects a kept slot
also written by the same step's required extracts, response headers, writable
text/form/handoff captures or final URL, before any request. An `absent` text
guard writes nothing and may share the slot.

```ts
optionalExtractsToCarry: {
  bcKey: { pointer: '/bean/bcKey' },
  userName: { pointer: '/bean/userName', fallback: '' },
  did: { pointer: '/did', keepExisting: true },
}
```

## Required credentials

`requiredCreds` maps a creds field to a `CredRule`. `checkRequiredCreds` in
`Flow/RequiredCreds.ts` runs before keys are generated or any request is sent.
`admitFlow`
(`src/Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/TokenStrategyFromConfig.budget.ts`)
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

## Carry generators

A step's `generate` list (`ICarryGenerator`, `GeneratorTypes.ts`) makes
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
| `ecdh-key`   | `generateEcdhKey` (`IEcdhKeyGenerator`, `Crypto/EcdhKeypair.ts`): a fresh key pair on `curve` (`secp256k1`), base64. The uncompressed public point (65 bytes, 0x04 first) goes to `publicInto`        |

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

Back to [API-DIRECT-CALL](../api-direct-call.md).
