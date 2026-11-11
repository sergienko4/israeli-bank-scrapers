# API-DIRECT-CALL — Session and Transport

How a finished login hands its session and cookies to the scrape, and how a warm start restores them.

## Session carry

Once the login succeeds, the ACTION stage installs the session context the
scrape phase reads (`getSessionContext`). By default that is the full carry
snapshot. A flow whose carry holds registration secrets (a device key, an
issued certificate, client credentials) names what the scrape may see in
`sessionCarry`:

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

Each slot must name a body or header extract, a `script-json` output, or the
`finalUrlInto` slot (a final URL its manual redirect checked) of some login or
resume step (a [build-time check](checks.md#build-time-config-checks)), so a generated
key or a seeded credential can never be allowlisted.

## Cookie hand-off

A login on one gateway can leave cookies the scrape must not send: a `Path=/`
cookie scoped to the bank's registrable domain matches every later read on a
sibling host. `cookieHandoff` (a `CookieHandoff`) decides what a finished
login leaves in the session jar:

- `shared` (the default) leaves the jar as the login left it.
- `isolate` moves the jar's cookies to the run's private stash
  (`ILongTermTokenSlot.handoffCookies`) and empties the jar, so the scrape
  starts from an empty jar and sends only cookies its own calls set.

`handOffCookies` (`Flow/CookieHandoff.ts`) runs in `finishFlow` after every
successful cold or warm login, right after the warm export, so a kept jar is
published in the next warm token before it is emptied. `isolate` needs a
domain jar (`transport.cookieDomains`, a
[build-time check](checks.md#build-time-config-checks)). Durable device auth
(`persistentAuth`) runs its own flows and never hands off. An in-run recovery
puts the stash back before it resumes; see [Auth recovery](auth.md#auth-recovery).

## Session-transport fields

Some banks keep the session in cookies shared by sibling hosts, and answer
login calls with redirects, HTML pages or response headers instead of JSON
alone. Reading, encoding, headers and domain cookies work on either node
transport (`nativeFetch` or node:https with a certificate or TLS profile).
Step redirects and bank-wide redirect, status, failure-text and media-type
and strict UTF-8 defaults need `transport.nativeFetch`; response integrity at
either bank or step level also requires native fetch. Step media types and
strict UTF-8 work on either node transport. The transport side of each field
is described in
[HTTP transports](../../architecture/pipeline.md#http-transports), and
the [build-time config checks](checks.md#build-time-config-checks) refuse combinations
that cannot work.

Bank-wide, on `transport`:

```ts
transport: {
  nativeFetch: true,
  sessionCookies: true,
  cookieDomains: ['bank.example'], // a Domain cookie reaches every *.bank.example host
  redirectPolicy: 'reject',        // any 3xx fails unless the step names its own redirect
  statusPolicy: { 204: 'empty' },  // a 204 answers {} without reading the body
  mediaTypes: { json: 'application/json' }, // every json answer must say so
  strictUtf8: true,                // a malformed UTF-8 byte fails the call
  responseIntegrity: { maxBytes: 4_194_304 }, // post-decompression byte ceiling
}
```

For a native-fetch bank, the media-type, strict UTF-8 and response
integrity defaults also apply to GraphQL answers; a call's own policy overrides
the corresponding default.

`IResponseIntegrity` accepts a `maxBytes` safe integer from 1 through
8,388,608 and an optional `sha256` of exactly 64 lowercase hexadecimal
characters. Native fetch checks the streamed post-decompression bytes before
decoding. An oversized body is aborted; a digest mismatch refuses the answer.
Redirect, status and media-type decisions that need only headers do not read or
hash their bodies. The digest is checked for API successes; failed responses
remain bounded and are classified as HTTP or WAF failures. When a failure
exceeds the limit, `isCloudflareBlock` checks only the permitted prefix; a
recognizable block remains `WAF_BLOCKED`, while other oversized failures
report a byte-limit refusal without assuming a WAF block. That oversized WAF
case returns the fixed block reason without the usual URL/status prefix.
`RESPONSE_BYTE_LIMIT_REASON`, `RESPONSE_DIGEST_MISMATCH_REASON`,
`RESPONSE_INTEGRITY_INVALID_REASON` and `RESPONSE_INTEGRITY_UNSUPPORTED_REASON`
name the fixed messages; `failResponseIntegrity` marks these refusals, and
the internal integrity-refusal tag survives step sanitization.
`isTerminalFailure` prevents a tagged refusal from triggering auth retries,
warm-session recovery or balance fallback, and `preferTerminalFailure` keeps a
refusal from a recovery attempt instead of an earlier degraded outcome.
Carry-bundle re-grants also return terminal refusals before considering
`coldFallback`, regardless of the remaining cold-login budget.
Cleanup is requested without waiting for a stream's cancellation promise.
A missing policy preserves ordinary transport behavior.

The shared `isResponseIntegrity` validator checks the same bounds at build and
transport boundaries. `toApiWiring` and `selectApiMediator` pass the
bank default into the native transport, while `checkResponseIntegrity`
refuses unsupported paths. `makeInvokeCapped` and `verifyResponseIntegrity`
enforce the per-call policy; The capped GraphQL transport uses that same
reader for opted-in GraphQL calls.

`cookieDomains` needs `sessionCookies`. List only the bank's own registrable
domains, never a public suffix such as `co.il`: the jar trusts the list as
reviewed config and keeps no public-suffix list
([HTTP transports](../../architecture/pipeline.md#http-transports)).

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
  ([HTTP transports](../../architecture/pipeline.md#http-transports)).
  `@cookie-strict:<name>` must URI-decode to a value a header can carry, or
  the request fails `"cookie <name> undecodable"` before it is sent. Either
  form takes a `?<fallback>` (`@cookie:language?HEBREW`, `@cookie:tuuid?`),
  sent verbatim when the cookie is missing or empty.
- `redirect` overrides `transport.redirectPolicy` for one step
  ([Redirect policies](../../architecture/pipeline.md#redirect-policies)); with
  a manual one, `finalUrlInto` carries the URL that gave the final answer
  ([Final URL carry](flow.md#final-url-carry)). A POST step names a manual one only
  with `postAsGet: true`: a 302/303 answer is followed as a body-less GET
  without the body headers, and a 301/307/308 is refused.
- `response: 'document'` and `documentMarker` read a page instead of JSON;
  `response: 'text'` reads the answer as `{ text }`, up to `maxTextChars`
  (65 536 by default), and `textCaptures` read slots off it
  ([Text captures](captures.md#text-captures)); `formCapture` reads a login form's
  hidden fields off it ([Login-form capture](captures.md#login-form-capture)), and
  `locationCapture` the URL its handoff script sends the client to
  ([Handoff script capture](captures.md#handoff-script-capture)); `structuredCapture`
  can select an allowlisted SDK reference ([SDK reference capture](captures.md#sdk-reference-capture));
  `statusPolicy` decides a 2xx or an explicitly configured rate limit before any body is read
  ([Document responses and status policies](../../architecture/pipeline.md#document-responses-and-status-policies)).
- `mediaType` names the one lower-case `type/subtype` the answer's
  `content-type` must carry, parameters aside, over the bank's
  `transport.mediaTypes` default for the step's response kind; a missing or
  different type fails the step `<step> unexpected media type`, after the
  status policy and before the body is read
  ([Document responses and status policies](../../architecture/pipeline.md#document-responses-and-status-policies)).
- `strictUtf8` decodes the answer's bytes as strict UTF-8, over the
  bank's `transport.strictUtf8`; a malformed byte fails the step
  `<step> body not utf-8` instead of becoming U+FFFD. `strictUtf8: false`
  lifts the bank's `true` for that step's body reading, and fails the
  build on a bank that is not strict
  ([Document responses and status policies](../../architecture/pipeline.md#document-responses-and-status-policies)).
- `responseIntegrity` overrides `transport.responseIntegrity` for one step.
  Configure `maxTextChars` separately for text answers: it is a character cap,
  not the byte cap. `API_DIRECT_INTEGRITY_RULES` refuses malformed policies at
  build time; transports that cannot enforce a policy refuse it before I/O.
- `headerExtractsToCarry` reads a header of the final response; a missing
  header without `fallback` fails with `<step> header missing`
  ([Response-header carry](../../architecture/pipeline.md#response-header-carry)).
- `deriveCarry` runs once the step's extracts are in scope
  ([Carry derivation](flow.md#carry-derivation)).
- `encoding: 'form'` sends the body as `application/x-www-form-urlencoded`,
  `encoding: 'form-utf8'` the same under exactly
  `application/x-www-form-urlencoded;charset=UTF-8`, and
  `encoding: 'form-latin1'` the same over ISO-8859-1; each shape must be
  a flat record of `$ref`, `$join` and scalar `$literal` values, or one
  `$merge` whose `set` is such a record. `encoding: 'text'`
  sends the string of a `{ text }` body verbatim, with no content-type
  ([Form bodies](../../architecture/pipeline.md#form-bodies)). `isFlatFormBody`
  guards the hydrated form step and both form writers against arrays and
  nested values.
- `seal` writes credentials, sealed under the bank's RSA key, at body
  pointers: one under a hex modulus (`rsa-pkcs1-block-xor`), or each alone
  under a PEM or DER key (`rsa-pkcs1-v15`); no value reaches carry
  ([Sealed fields](../../architecture/pipeline.md#sealed-fields)).
  The builder compares `writeTo` paths after `decodePointerSegments` applies
  the writer's JSON-pointer decoding, rejecting duplicate and
  ancestor/descendant targets before the request.
  Sealing clones JSON branches independently, so repeated references or
  shared literals cannot make one field overwrite another field's seal.
- `setCookies` writes client cookies, host-only with `Path=/` and `Secure`,
  before the step's request. A `{ ref, optional: true }` source skips an
  absent or empty value; nonempty invalid values still fail. `$ref: cookie.<name>` reads the cookie that
  applies to the step URL, URL-decoded
  ([Client cookies](../../architecture/pipeline.md#client-cookies)).
- `clientCert` installs a device certificate the run obtained, presented to
  the bank origin from that step on ([Device certificate](signing.md#device-certificate)).
- `extractRules` checks a body or header extract's type, text, length, URL,
  certificate or equality to a ref before it reaches carry
  ([Extract rules](codecs.md#extract-rules)).
- `runIf` skips the step, pre-hook included, unless a carry slot holds one of
  the listed texts ([Conditional steps](overview.md#conditional-steps)).
- `generate` writes fresh device material, such as an RSA key, into carry
  before the body is hydrated ([Carry generators](flow.md#carry-generators)).
- `omitBankText: true` on the config keeps reply text out of a missed extract
  and out of a failed scrape call, and records a length-only hint for
  `error_code` in login diagnostics
  ([Bank text in failures](errors.md#bank-text-in-failures)).
- `transport.omitBankText: true` also omits bank text from native HTTP failures,
  including post-login data calls. WAF classification still runs first
  ([HTTP transports](../../architecture/pipeline.md#http-transports)).

## Cookie-jar warm start

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

## Carry-bundle warm start

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

Back to [API-DIRECT-CALL](../api-direct-call.md).
