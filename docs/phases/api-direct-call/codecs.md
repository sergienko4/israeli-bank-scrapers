# API-DIRECT-CALL — Codecs and Response Rules

How an answer is classified, checked and decoded, including the AES envelope codec.

## Answer classifier

Some banks answer one step in several shapes, such as a finished login, an
OTP challenge or a locked account, all with HTTP 200. A step that declares
`classify` (an `IAnswerClassifier`) names those shapes as cases. The step's
opened answer is classified after its [bank-error guard](errors.md#bank-error-guard)
and its [outcome](errors.md#step-outcome), and before its extracts run. `judgeAnswer`
(in `Flow/RunStep.judge.ts`) runs `judgeStepOutcome`, then `classifyAnswer`
(in `Flow/RunStep.classify.ts`):

```ts
classify: {
  into: 'loginBranch',
  cases: [
    { name: 'done', when: [{ pointer: '/data/state', equals: 'ok' }] },
    {
      name: 'otp',
      when: [{ pointer: '/data/targets', keys: 1 }],
      captures: {
        otpTarget: { pointer: '/data/targets', maxChars: 64, onlyKey: true },
        otpLength: { pointer: ['/data/len', '/data/length'], maxChars: 2, integer: { min: 4, max: 10 } },
      },
    },
    { name: 'locked', when: [{ pointer: '/data/locked', equals: true }], fail: ScraperErrorTypes.AccountBlocked },
  ],
},
```

A case matches when every check in its `when` passes, and exactly one case
must match. Cases are counted, not names, so a name may repeat across cases
that describe one branch. When no case matches, the step fails `Generic` with
`<step> answer unrecognized`; when more than one matches, with
`<step> answer ambiguous`. A matched case with `fail` stops the step with that
type and `<step> answer <case>`; the case name comes from the config, so it is
safe to show. Any other match writes its name to carry `into`, beside its
captures. The classifier's slots are merged over the step's extract slots,
though the build refuses a slot that both write on one step.

A check's `pointer` is an `AnswerPointer`: one JSON pointer, or alternatives of
which `resolveFirst` (in `Flow/RunStep.classify.checks.ts`) reads the first
that resolves. `passesCheck` then applies the check's one kind:

| Kind           | Passes when the value                                          |
| -------------- | -------------------------------------------------------------- |
| `absent: true` | is missing: no alternative resolves (`null` counts as present) |
| `equals`       | is `===` the string, number, boolean or `null`                 |
| `oneOf`        | is a string or number `===` one of the list                    |
| `items`        | is an array of exactly that many items                         |
| `keys`         | is an object of exactly that many keys                         |
| `text`         | is safe text (below) that matches the whole `pattern`, if any  |

Every kind but `absent` fails when no alternative resolves, and a check with
no kind never passes. `negate: true` inverts a check's verdict, so
`{ pointer, equals: 'SUCCESS', negate: true }` passes on any other value,
`null` or a missing pointer included, and `{ pointer, absent: true, negate:
true }` passes when the pointer resolves. A negated check with no kind still
never passes. `isSafeText` accepts a string of 1..`maxChars` chars
with no C0 control char and no DEL. A `pattern` is compiled alone with the `u`
flag, then wrapped in `^(?:…)$`, so it must match the whole text; a pattern
that does not compile alone, such as `a)|(?:b`, which would escape the wrapper,
fails its check.

A matched case's `captures` map carry slots to an `IAnswerCapture`.
`readCaptures` (in `Flow/Captures/RunStep.classify.captures.ts`, fed an
`ICaptureInput`) reads each one as text: by default the value must be a
string; with `onlyKey: true`, an object of exactly one key gives that key;
with `integer` (an `IAnswerRange`), a safe JSON integer from `min` to `max`
gives its decimal text. Unsafe numbers cannot preserve an identifier's
precision; larger identifiers must arrive as strings and use the default
text capture. Every captured text must then pass `isSafeText` with the
capture's `maxChars`. A capture whose pointer misses fails `Generic` with
`<step> answer capture <slot> missing`; any other refusal with
`<step> answer capture <slot> invalid`. No value is ever named.

An unrecognized or ambiguous answer is logged at debug level with the step
name, the matched case names and the answer's redacted shape, never a value
or a bank-supplied key name. `answerShape` (in
`Flow/RunStep.classify.shape.ts`) builds it: a scalar becomes its JSON type,
an object's keys become anonymous `<key:i>` positions, and an array keeps its
items' shapes. Six levels are walked; a deeper container prints as
`object(n)` or `array(n)`. At most 64 entries (keys and items) are shown in
all, shallower ones first; a cut object
ends with `'...': '+n'` and a cut array with `'...+n'`. A step without
`classify` behaves as before.

The build refuses a malformed classifier
([Build-time config checks](checks.md#build-time-config-checks)): every case needs a
check, every check exactly one kind, and every pointer alternative must be a
JSON pointer below the body root. A text `pattern` must be anchored, compile
alone and be flat, as an extract rule's must; every `maxChars` is an integer
from 1 to 65536; a capture reads one mode, over a whole, ordered integer
range. A capture never writes `into`, no classifier slot is also written by the
same step's extracts, final URL, form or handoff capture, or derivation;
`into` is never a `sessionCarry` slot, and a `runIf` guard on a slot some
classifier writes may list only the case names written there.

## Extract rules

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
  any decoded path holding none of the denied texts), no user info and no
  fragment. Malformed path escapes are refused.
  The slot keeps the text as sent, not the resolved URL.
- `pemCertificate: { keyRef }` (`IPemCertificateRule`) is checked by
  `isPemCertificate` (in `Flow/Signing/RunStep.pemRule.ts`). It demands exactly one
  PEM block, a `CERTIFICATE` that parses as X.509, certifies the private key
  `keyRef` resolves to and is valid now (`validFrom ≤ now ≤ validTo`). The key
  ref resolves to text with `resolveRefText` (in `Template/RefResolver.ts`)
  against the step's prepared scope, so it reads a key an earlier step or this
  step's [generators](flow.md#carry-generators) put in carry.
- `equalsRef` is checked last, on the text the other checks kept. The
  ref resolves to text with `resolveRefText` against the step's prepared scope,
  and the slot text must equal it exactly (case and all). An unresolved ref is
  a mismatch.
- A string always runs the text checks. A finite number runs them, stringified,
  only when the rule sets one; any other value under a text check is refused.
  The type checks (`isTypeSound`, `isFiniteNumber`) live in
  `Flow/RunStep.extractTypes.ts`.
- An optional slot whose pointer is unresolved, `null` or blank skips its
  rule only if neither a fallback nor its step's pre-hook wrote the slot.
  Those values are checked before they are carried. A present nonblank
  non-text value is checked raw, even if a fallback is configured.
  A header slot is always ruled: it holds the header, or its `fallback`.

```ts
extractsToCarry: { certPem: '/certPem' },
headerExtractsToCarry: { deviceStatus: { header: 'device-status' } },
extractRules: {
  certPem: { type: 'string', pemCertificate: { keyRef: 'carry.certKeyPem' } },
  deviceStatus: { oneOf: ['activated'] },
},
```

```ts
extractsToCarry: { mi6: '/Login/MI6' },
extractRules: { mi6: { type: 'string', equalsRef: 'carry.uidMd5' } },
```

A refused value fails the step `Generic` with `<step> extract <slot> invalid`;
a text that differs from its `equalsRef` fails it with
`<step> extract <slot> mismatch`. Both fail before any later step or OTP
prompt, and neither message names the value.

## Envelope codec

Some banks wrap every JSON request and answer in an AES-256-CBC envelope. A
POST step names it with `codec` (an `EnvelopeCodec`). In `sealed` mode
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
- `sealGuardedBody` (in `Flow/Signing/RunStep.codec.ts`) seals the body last, after
  its signature and form guard. The hydrated body must be exactly
  `{ headers, data }`: at most 16 header records and a data record, or the
  step fails `<step> envelope body invalid`. `sealEnvelope` sends `headers`
  (one `encryption` record naming the `iv` and the `crypto_session_id`),
  `enc_headers` and `data`: each header and the data are sealed as UTF-8
  JSON, PKCS#7 padded, base64, under one fresh 16-byte IV.
- `openGuardedAnswer` opens the answer before its
  [bank-error guard](errors.md#bank-error-guard), outcome and extracts, which then read
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
- An answer must come back sealed. A plaintext answer with a non-zero
  numeric `error_code` fails `<step> bank error`, typed by the step's
  [`bankErrorType`](errors.md#bank-error-guard); any other plaintext answer fails
  `<step> envelope invalid` (`Generic`). Opened data with such an `error_code`
  fails `<step> bank error` too.
- Only the opened data's key count is logged. Login request and response
  diagnostics likewise use key counts, never bank-controlled field names.
  A failure names the step only, never a key, an IV or plaintext.
- `toSession` returns an `IEnvelopeSession` (the key bytes and the id).
  `Crypto/EnvelopeWire.ts` holds what sealing and opening share: `CIPHER`
  (`aes-256-cbc`), `IV_BYTES` (16), `canonicalBytes` (base64 that re-encodes
  to the same text), `isJsonRecord`, `headerList` and `headersOfType`. Tests
  pass `sealEnvelopeWithIv` a fixed IV to match openssl goldens.

The key-exchange step that opens the session names the `exchange` mode
(`IEnvelopeExchange`). It reads the client scalar an
[`ecdh-key` generator](flow.md#carry-generators) wrote, and writes the session for
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
- An exchange may opt into `echoRef: 'carry.ecdhPublic'`. Before sending, the
  reference must resolve to nonempty text exactly matching `y` in the one
  outgoing `key_exchange` header. The one response `key_exchange` header must
  then carry the same text in `echo_y` before the session is accepted. Missing,
  ambiguous or mismatched values fail without disclosing either point; absent
  `echoRef` leaves existing exchanges unchanged. The builder requires a
  nonblank `carry.` slot for this option.
- The answer must open under that session, as in `sealed` mode. Then
  the key (base64) goes to the `keyInto` slot and the id to `sessionInto`;
  the step's extracts read the opened answer and run after, so an extract
  into the same slot wins.
- `Flow/Signing/RunStep.codec.ts` holds one seal and one open per mode in
  `CODEC_MODES`, so a new mode is one row. `sealSealedBody` and
  `openSealedAnswer` live in `Flow/Signing/RunStep.codec.sealed.ts`;
  `checkExchangeKey` and `openExchangeAnswer` in
  `Flow/Signing/RunStep.codec.exchange.ts`. Both open through `openForStep` (in
  `Flow/Signing/RunStep.codec.open.ts`), which returns an `IOpenedAnswer` (the
  answer and its bundle) and fails opened data that `hasBankErrorCode`
  flags. `stepFail` prefixes a reason with the step name, and `KEY_INVALID`
  is the shared `envelope key invalid` reason.

Back to [API-DIRECT-CALL](../api-direct-call.md).
