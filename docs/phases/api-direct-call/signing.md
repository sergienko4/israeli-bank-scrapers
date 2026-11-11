# API-DIRECT-CALL — Signing and Crypto

How api-direct requests prove integrity: the signer union, body templates, crypto hooks, phone form, and the device certificate.

## Signer (discriminated union)

| Kind       | Used by | Algorithm             | Signature placement     |
| ---------- | ------- | --------------------- | ----------------------- |
| Asymmetric | Pepper  | ECDSA-P256 / RSA-2048 | Header-attached         |
| Symmetric  | PayBox  | AES-CBC-PKCS7         | Body — RFC-6901 pointer |

Banks declare the algorithm + canonical-string parts + key-ref in their `PipelineBankConfig.transport.signer` literal; the mediator dispatches without bank knowledge.

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

## JsonValueTemplate

Declarative body literal with `$ref` tokens:

| Token                        | Resolves to                              |
| ---------------------------- | ---------------------------------------- |
| `$literal: "v"`              | Literal value `"v"`                      |
| `$ref: creds.<field>`        | The credential at that key               |
| `$ref: carry.<slot>`         | The flow's per-step carry slot           |
| `$ref: config.<dotted.path>` | The bank's config object                 |
| `$ref: cookie.<name>`        | The cookie for the step URL, URL-decoded |
| `$ref: …, optional: true`    | The same, or no key when absent          |
| `$join: { parts, … }`        | One string built from refs and literals  |
| `$merge: { base, set }`      | A carried record with `set` laid over it |

A `$join` node (`IJoinTemplate`) concatenates its `parts` in order. Each
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

An optional ref, such as `{ $ref: 'carry.did', optional: true }`, is for a
value the bank wants only when the run has one: a device id an earlier run
stored, say. When its carry slot, credential field or cookie is absent,
`hydrate` leaves its key out of the record (`isRefAbsent` in
`Template/RefPresence.ts` tells which sources can be absent); when it is
present, the ref acts as a plain `$ref`. Any other failure still fails the
step: an unknown token, a `config.` miss, a cookie value too long or badly
escaped. It may stand only as
the value of a key in a JSON body or a `queryTemplate`. At a root, inside an
array or anywhere in a header the build fails with
`steps: optional ref only as an object value`, and a form body's flat-record
rule refuses it too. A `$join` part and a raw query name ref tokens, not
`$ref` nodes, so neither can hold one:

```typescript
queryTemplate: {
  aid: { $literal: 'app-1' },
  did: { $ref: 'carry.did', optional: true },
},
```

A `$merge` node (`IMergeTemplate`) sends back a form the bank handed out
([Login-form capture](captures.md#login-form-capture)). `hydrateMerge` (in
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

## CryptoField pre-hook

Per-step optional encryption hook: takes a value from carry (e.g. the SMS OTP), AES-encrypts it with a key from `config.secrets.*` or `carry.<slot>`, writes the ciphertext into the outbound body at an RFC-6901 pointer, and scrubs the plaintext. PayBox uses this to encrypt the OTP into `/pin` with a fresh IV at `/pinIv`.

## Phone normaliser

Every api-direct bank declares its wire format in `PipelineBankConfig.transport.phoneNumberFormat`:

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

## Device certificate

A bank whose login obtains its device certificate at runtime declares a
dynamic `clientCert` on its transport block
([Dynamic client certificate](../../architecture/pipeline.md#dynamic-client-certificate)).
The step that has the key and the issued certificate in scope names them in
its `clientCert` (`IStepClientCert`): refs to the PEM private key and the
PEM certificate.

```ts
clientCert: { key: 'carry.certKeyPem', cert: 'carry.certPem' },
```

`prepareStepSession` (in `Flow/RunStep.session.ts`) runs before the step's
URL, body or headers resolve: it binds the step's client cookies, then
`installStepCert` (in `Flow/Signing/RunStep.clientCert.ts`) resolves both refs to text
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
before it reaches carry ([Extract rules](codecs.md#extract-rules)).

Back to [API-DIRECT-CALL](../api-direct-call.md).
