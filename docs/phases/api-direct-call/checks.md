# API-DIRECT-CALL — Build-time Config Checks

The validators that reject an inconsistent bank config before it reaches the network.

## Build-time config checks

Builder rules are grouped by concern without changing their evaluation order:
`Core/Builder/Transport/` holds request bodies, response policies, cookies and client
certificates; `Core/Builder/Auth/` holds warm sessions, generators, derivations,
seals and codecs; `Core/Builder/Captures/` holds response captures and classifiers;
and `Core/Builder/Validation/` holds the config entrypoint, step guards and URL rules.
The five companion validators live with their corresponding rule groups.
`ApiDirectRuleInput.ts` and `FlatPattern.ts` remain shared at the Builder root.

`validateApiDirectConfig` in `Core/Builder/Validation/ApiDirectConfigRules.ts` runs when
the pipeline is built (`build()` → `buildDescriptor` → `validateBuilderFields`).
Its input, `IApiDirectRuleInput`, is the call config plus the bank's `transport`
block from the registry, so a config that cannot work fails before any request
is sent. `Core/Builder/ApiDirectRuleInput.ts` holds that input, the rule shape
`IApiDirectRule` (a message and an `isBroken` check), `allSteps`, which
lists the login steps and any durable resume steps, `anyStep`, which breaks a
rule when any of those steps fails a check, and `isExtractSlot`, which
says whether a slot names one of a step's body, header or text-capture slots
(the last through `captureSlotsOf`, which skips `absent` guards).
It also holds `isBodyPointer`, which accepts a JSON pointer below the body
root, `isBadCharCap`, which refuses a `maxChars` that is not an integer from 1
to 65536, and the answer-classifier walk: `classifiersOf` lists every step's
`classify`, `anyClassifier` breaks a rule when any of them fails a
`ClassifierCheck`, and `answerChecksOf` and `answerCapturesOf` list a
classifier's checks and its `AnswerCaptureEntry` slot and capture pairs.
The `API_DIRECT_OUTCOME_RULES` in `Core/Builder/Validation/ApiDirectStepRules.ts` reject empty
success lists and case-insensitive failure-map collisions before warm-start
checks. The
session-transport rules, `API_DIRECT_TRANSPORT_RULES` in
`Core/Builder/Transport/ApiDirectTransportRules.ts`, run after the core rules, then the form-body rules, `API_DIRECT_FORM_RULES` in
`Core/Builder/Transport/ApiDirectFormRules.ts`, which end with the `$merge` rules,
`API_DIRECT_MERGE_RULES` in `Core/Builder/Transport/ApiDirectMergeRules.ts`, then the seal rules,
`API_DIRECT_SEAL_RULES` in `Core/Builder/Auth/ApiDirectSealRules.ts`, then the
step rules, `API_DIRECT_STEP_RULES` in `Core/Builder/Validation/ApiDirectStepRules.ts`,
then the text-capture rules, `API_DIRECT_TEXT_RULES` in
`Core/Builder/Captures/ApiDirectTextRules.ts`, which end with the login-form capture
rules, `API_DIRECT_FORM_CAPTURE_RULES` in
`Core/Builder/Captures/ApiDirectFormCaptureRules.ts`,
then the carry-generator rules, `API_DIRECT_GENERATE_RULES` in
`Core/Builder/Auth/ApiDirectGenerateRules.ts`, which end with the envelope codec
rules, `API_DIRECT_CODEC_RULES` in `Core/Builder/Auth/ApiDirectCodecRules.ts`,
the step URL rules, `API_DIRECT_URL_RULES` in
`Core/Builder/Validation/ApiDirectUrlRules.ts`, and the optional-ref rule,
`API_DIRECT_OPTIONAL_REF_RULES` in `Core/Builder/Validation/ApiDirectOptionalRefRules.ts`,
then the answer-classifier rules, `API_DIRECT_CLASSIFY_RULES` in
`Core/Builder/Captures/ApiDirectClassifyRules.ts` and `API_DIRECT_CLASSIFY_SLOT_RULES` in
`Core/Builder/Captures/ApiDirectClassifySlotRules.ts`,
then the dynamic client-certificate
rules, `API_DIRECT_CLIENT_CERT_RULES` in
`Core/Builder/Transport/ApiDirectClientCertRules.ts`, then the session rules,
`API_DIRECT_SESSION_RULES` in `Core/Builder/Auth/ApiDirectSessionRules.ts`. The
transport rules, `API_DIRECT_NATIVE_RULES` in
`Core/Builder/Transport/ApiDirectNativeRules.ts`, run last: step reading and domain
cookies are rejected off either node transport; redirects and native-only
bank defaults are rejected on node:https too. `NATIVE_TRANSPORT_FIELDS` names
the native-only defaults checked by both api-direct and node-tls builders.
The first broken rule
fails the build with `Generic` and `<field>: <rule>`:

| Broken when                                                                                                                                 | Message                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `authScheme: 'prefixed'` with a missing or blank `authPrefix`                                                                               | `authPrefix: required when authScheme is prefixed`                                 |
| `authScheme: 'none'` without `transport.sessionCookies: true`                                                                               | `transport.sessionCookies: required when authScheme is none`                       |
| `transport.sessionCookies` and any login or resume step with `cookieJar`                                                                    | `steps.cookieJar: not allowed with transport.sessionCookies`                       |
| any login or resume step whose `outcome.successCodes` is empty                                                                              | `outcome.successCodes: must not be empty`                                          |
| `warmStart` validated as `'jwt'` (the default) with no `jwtClaims`                                                                          | `jwtClaims: required when warmStart.validation is jwt`                             |
| `warmStart` validated as `'bank-call'` with a `fromStepIndex` that names no step                                                            | `warmStart.fromStepIndex: must name a step when validation is bank-call`           |
| `warmStart.fromStepIndex` below 1                                                                                                           | `warmStart.fromStepIndex: must start after the first step`                         |
| `warmStart.fromStepIndex` fractional, `NaN` or above `steps.length`                                                                         | `warmStart.fromStepIndex: must be a whole number up to the step count`             |
| `warmStart` validated as `'bank-call'` whose `fromStepIndex` step has a `runIf` guard                                                       | `warmStart.fromStepIndex: a bank-call check step must not have runIf`              |
| a `kind: 'cookie-jar'` or `'carry-bundle'` `warmStart` with a blank `provider`                                                              | `warmStart.provider: must not be blank`                                            |
| a `kind: 'cookie-jar'` `warmStart` with a blank `accountField`                                                                              | `warmStart.accountField: must not be blank`                                        |
| a `kind: 'cookie-jar'` or `'carry-bundle'` `warmStart` whose `maxTokenChars` is not an integer from 1 to 16384                              | `warmStart.maxTokenChars: must be an integer from 1 to 16384`                      |
| a `kind: 'cookie-jar'` `warmStart` without `transport.cookieDomains`                                                                        | `warmStart.kind: cookie-jar not allowed without transport.cookieDomains`           |
| a `kind: 'carry-bundle'` `warmStart` with no `accountFields`, or a blank one (`API_DIRECT_WARM_BUNDLE_RULES`)                               | `warmStart.accountFields: must name a creds field, none blank`                     |
| a `kind: 'carry-bundle'` `warmStart` with an empty `slots`                                                                                  | `warmStart.slots: must not be empty`                                               |
| a `kind: 'carry-bundle'` `warmStart` keeping a slot no login step extracts or generates                                                     | `warmStart.slots: each slot must be filled by a login step`                        |
| a `kind: 'carry-bundle'` `warmStart` with `cookies: true`, without `transport.cookieDomains`                                                | `warmStart.cookies: not allowed without transport.cookieDomains`                   |
| a `response: 'document'` step with any `extractsToCarry`, `optionalExtractsToCarry`, `outcome` or nonempty `failIfPresent`                  | `steps.response: a document step reads no body extracts, outcome or failIfPresent` |
| a `documentMarker` on any step whose `response` is not `'document'`                                                                         | `steps.documentMarker: only on a document step`                                    |
| a manual `redirect` on a POST step without `postAsGet: true`                                                                                | `steps.redirect: manual on a POST step needs postAsGet`                            |
| a manual `redirect` with `postAsGet` on a GET step                                                                                          | `steps.redirect: postAsGet only on POST steps`                                     |
| a manual `transport.redirectPolicy` (the default every POST shares)                                                                         | `transport.redirectPolicy: manual only on GET steps`                               |
| a manual `redirect` whose `allow` list is empty                                                                                             | `redirect.allow: must not be empty`                                                |
| a manual `redirect` whose `maxHops` is not an integer from 1 to 10                                                                          | `redirect.maxHops: must be an integer from 1 to 10`                                |
| a manual `redirect` on any step while `transport.redirectPolicy` is not `'reject'`                                                          | `transport.redirectPolicy: must be reject when a step redirects manually`          |
| a form step (`form`, `form-utf8` or `form-latin1`) whose body shape is not a flat record of `$ref`, `$join` and scalar `$literal` values    | `steps.body: a form body must be a flat record`                                    |
| a `text` step whose body shape is not exactly `{ text }`                                                                                    | `steps.body: a text body must be exactly { text }`                                 |
| a form step whose whole-shape `$merge` (`isMergeRoot`) has a `base` off `carry.<slot>` or a `set` that is not flat                          | `steps.body: a form body must be a flat record`                                    |
| a `$merge` anywhere but a form body's whole shape: a JSON or text body, a field, a header, a query (`API_DIRECT_MERGE_RULES`)               | `steps: $merge belongs only at the root of a form body`                            |
| a `seal` whose `kind` is not a `SealKind`                                                                                                   | `steps.seal.kind: unknown seal kind`                                               |
| a `seal` on a step that is not a `POST` with a record body                                                                                  | `steps.seal: needs a POST step with a record body`                                 |
| a `seal` with a `writeTo` that is not a JSON pointer                                                                                        | `steps.seal.writeTo: must be a JSON pointer`                                       |
| a `seal` with no fields or overlapping `writeTo` paths                                                                                      | `steps.seal.fields: needs at least one field with non-overlapping writeTo paths`   |
| a block-xor `seal` whose `params` are out of range (exponent, seed, block size or printable text)                                           | `steps.seal.params: out of range`                                                  |
| a login or resume step with a `failIfPresent` entry that is not a JSON pointer below the body root                                          | `steps.failIfPresent: each entry must be a JSON pointer`                           |
| a login or resume step with a `bankErrorType` but no `failIfPresent` entry and no codec                                                     | `steps.bankErrorType: needs failIfPresent or a codec`                              |
| an `extractRules` key that names no `extractsToCarry`, `optionalExtractsToCarry`, `headerExtractsToCarry` or `textCaptures` slot            | `steps.extractRules: each key must name a body or header extract`                  |
| an `extractRules` `pattern` that does not start with `^`, end with `$` and compile with the `u` flag                                        | `steps.extractRules.pattern: must be an anchored regex`                            |
| an `extractRules` `pattern` with a group, an alternation or a variable repeat before its last atom                                          | `steps.extractRules.pattern: must be a flat regex`                                 |
| an `extractRules` `maxChars` that is not an integer from 1 to 65536                                                                         | `steps.extractRules.maxChars: must be an integer from 1 to 65536`                  |
| an `extractRules` `oneOf` or `url` list that is empty                                                                                       | `steps.extractRules: oneOf and url must not be empty`                              |
| a login or resume step whose `runIf` has a blank `carry` or an empty `oneOf`                                                                | `steps.runIf: carry and oneOf must not be empty`                                   |
| a login or resume step with `textCaptures` whose `response` is not `'text'` (`API_DIRECT_TEXT_RULES`)                                       | `steps.textCaptures: need a text response`                                         |
| a login or resume step with `maxTextChars` whose `response` is not `'text'`                                                                 | `steps.maxTextChars: needs a text response`                                        |
| a `maxTextChars` that is not an integer from 1 to 2097152                                                                                   | `steps.maxTextChars: must be an integer from 1 to 2097152`                         |
| a `textCaptures` `pattern` that does not compile with the `g` flag                                                                          | `steps.textCaptures.pattern: must compile`                                         |
| a `textCaptures` `pattern` with a group followed by `*`, `+` or `{`                                                                         | `steps.textCaptures.pattern: must not repeat a group`                              |
| a `textCaptures` `group` that is not an integer from 0 to its pattern's group count                                                         | `steps.textCaptures.group: must name a group of its pattern`                       |
| a login or resume step with `formCapture` whose `response` is not `'text'` (`API_DIRECT_FORM_CAPTURE_RULES`)                                | `steps.formCapture: needs a text response`                                         |
| a `formCapture` with an empty `form` or `into`                                                                                              | `steps.formCapture: form and into must not be empty`                               |
| a `formCapture` `action` that is not an absolute https URL written as `new URL(action).href`                                                | `steps.formCapture.action: must be an absolute https URL`                          |
| a `formCapture` whose `minFields` or `maxFields` is not an integer, or not `1 <= minFields <= maxFields`                                    | `steps.formCapture: needs integers 1 <= minFields <= maxFields`                    |
| a `formCapture` `required` or `forbidden` name off `FORM_FIELD_NAME`, or named in both                                                      | `steps.formCapture: field names must be valid and disjoint`                        |
| a login or resume step with `locationCapture` whose `response` is not `'text'` (`API_DIRECT_LOCATION_CAPTURE_RULES`)                        | `steps.locationCapture: needs a text response`                                     |
| a `locationCapture` with an empty `into`, `userAgent` or `url`                                                                              | `steps.locationCapture: into, userAgent and url must not be empty`                 |
| a `locationCapture` `into` that the step also extracts, or names as its `finalUrlInto` or `formCapture` slot                                | `steps.locationCapture: must be a fresh slot`                                      |
| a login or resume step with an `rsa-key` generator that names neither `keyInto` nor `spkiSha256HexInto` (`API_DIRECT_GENERATE_RULES`)       | `steps.generate: rsa-key needs keyInto or spkiSha256HexInto`                       |
| a login or resume step with a `pkcs10-csr` generator whose `subject` is empty or whose `into` is blank                                      | `steps.generate: pkcs10-csr needs a subject and into`                              |
| a login or resume step with an `ecdh-key` generator whose `publicInto` or `privateInto` is blank, or both name one slot                     | `steps.generate: ecdh-key needs distinct publicInto and privateInto`               |
| a `sessionCarry` slot that is the `privateInto` of some `ecdh-key` generator                                                                | `steps.generate: ecdh-key privateInto must not be a sessionCarry slot`             |
| a login or resume step whose `preHook.valuePattern` does not start with `^`, end with `$` and compile with the `u` flag                     | `steps.preHook.valuePattern: must be an anchored regex`                            |
| a login or resume step whose `preHook.valuePattern` has a group, an alternation or a variable repeat before its last atom                   | `steps.preHook.valuePattern: must be a flat regex`                                 |
| a login or resume step whose `httpFailureMap` is empty (`API_DIRECT_HTTP_FAILURE_RULES`)                                                    | `steps.httpFailureMap: must not be empty`                                          |
| an `httpFailureMap` key that is not a `4xx` status, or a value outside the [login failure types](errors.md#http-failure-map)                | `steps.httpFailureMap: must map 4xx statuses to login failure types`               |
| a login or resume step with `clientCert`, without a `transport.clientCert` block (`API_DIRECT_CLIENT_CERT_RULES`)                           | `steps.clientCert: not allowed without transport.clientCert`                       |
| a `transport.clientCert` whose `origin` is not exactly `https://host[:port]` (no path, user, trailing slash or default port)                | `transport.clientCert.origin: must be an exact https origin`                       |
| `transport.clientCert` together with `transport.requiresClientCert: true`                                                                   | `transport.clientCert: not allowed with transport.requiresClientCert`              |
| a `sessionCarry` slot no login or resume step extracts, captures via `script-json`, or names as `finalUrlInto` (`API_DIRECT_SESSION_RULES`) | `sessionCarry: each slot must name a step extract`                                 |
| `cookieHandoff: 'isolate'` without `transport.cookieDomains`                                                                                | `cookieHandoff: isolate not allowed without transport.cookieDomains`               |
| a `persistentAuth` block whose `kind` has no supported primer (`API_DIRECT_PERSISTENT_AUTH_RULES`)                                          | `persistentAuth.kind: must be bound-device or device-memory`                       |
| a login or resume step with `response`, `documentMarker`, `headerExtractsToCarry` or `encoding` off native fetch and node:https             | `steps.<field>: not allowed without nativeFetch or node:https`                     |
| a login or resume step with `redirect`, without `transport.nativeFetch: true`                                                               | `steps.redirect: not allowed without transport.nativeFetch`                        |
| `transport.cookieDomains` off native fetch and node:https                                                                                   | `transport.cookieDomains: not allowed without nativeFetch or node:https`           |
| `transport.redirectPolicy`, `statusPolicy` or `omitBankText` without `transport.nativeFetch: true`, including node-tls banks                | `transport.<field>: not allowed without transport.nativeFetch`                     |
| `transport.cookieDomains` without `transport.sessionCookies: true`                                                                          | `transport.cookieDomains: not allowed without transport.sessionCookies`            |
| a `headerExtractsToCarry` header name that is not an HTTP token (RFC 9110)                                                                  | `headerExtractsToCarry.header: must be an HTTP header name`                        |
| a login or resume step with `setCookies`, without `transport.cookieDomains`                                                                 | `steps.setCookies: not allowed without transport.cookieDomains`                    |
| a `setCookies` cookie name that is not an HTTP token (RFC 9110)                                                                             | `steps.setCookies: each name must be an HTTP token`                                |
| a malformed required or optional `setCookies` source                                                                                        | `steps.setCookies: each source must be a valid ref or optional ref`                |
| a `seedCarryFromCreds` entry whose `random-hex` bootstrap draws a `bytes` count that is not an integer from 1 to 64                         | `seedCarryFromCreds: random-hex needs integer bytes from 1 to 64`                  |
| a seed with `alwaysBootstrap: true` but no random bootstrap                                                                                 | `seedCarryFromCreds: alwaysBootstrap needs a random bootstrap`                     |
| a `derivedCarry` or `deriveCarry` `op` with an unsupported `kind` (`API_DIRECT_DERIVE_RULES`)                                               | `derive.op.kind: must be format, md5-hex, url-query, url-path-map or url-compose`  |
| a `url-query` op without exactly one source part and a safe, nonblank key                                                                   | `derive.op.url-query: needs one part and a valid key`                              |
| a `url-query` op whose `rejectBlank` is neither omitted nor `true`                                                                          | `derive.op.url-query.rejectBlank: must be true when set`                           |
| a `url-path-map` with invalid source, selector, map or URL policies                                                                         | `derive.op.url-path-map: invalid mapping`                                          |
| a `url-compose` with invalid parts, URL policies or merge settings                                                                          | `derive.op.url-compose: invalid composition`                                       |
| a `format` op with no rule                                                                                                                  | `derive.op.rules: needs at least one rule`                                         |
| a `format` rule `pattern` that does not compile with the `u` flag                                                                           | `derive.op.rules.pattern: must compile`                                            |
| a `format` rule `pattern` outside the linear-time `FlatPattern` grammar                                                                     | `derive.op.rules.pattern: must be a flat regex`                                    |
| a `format` rule `padStart` that is not an integer from 0 to 64                                                                              | `derive.op.rules.padStart: must be an integer from 0 to 64`                        |
| a login or resume step with `codec` whose `encoding` or `response` is not `'json'` (`API_DIRECT_CODEC_RULES`)                               | `steps.codec: needs a json body and a json response`                               |
| an `exchange` codec whose `keyInto` or `sessionInto` is blank, or both name one slot                                                        | `steps.codec: exchange needs distinct keyInto and sessionInto`                     |
| a `sessionCarry` slot that a codec reads or writes: the `privateRef`, `keyRef` or `sessionRef` slot, `keyInto` or `sessionInto`             | `steps.codec: codec slots must not be sessionCarry slots`                          |
| a login or resume step with both `rawQuery` and `queryTemplate` (`API_DIRECT_URL_RULES`)                                                    | `steps.rawQuery: not with queryTemplate`                                           |
| a `urlFromCarry` slot with any unchecked earlier writer, or a pre-hook overwrite in its consumer step                                       | `steps.urlFromCarry: slot needs an earlier url rule`                               |
| a `finalUrlInto` on a step whose `redirect` is not manual                                                                                   | `steps.finalUrlInto: needs a manual redirect`                                      |
| a `finalUrlInto` slot that is blank, or that the step also extracts                                                                         | `steps.finalUrlInto: must be a fresh slot`                                         |
| an optional `$ref` at a body or query root, inside an array or in a header (`API_DIRECT_OPTIONAL_REF_RULES`)                                | `steps: optional ref only as an object value`                                      |
| a `response: 'document'` step with any `extractsToCarry` or `optionalExtractsToCarry`                                                       | `steps.response: a document step reads no body extracts`                           |
| a login or resume step whose `classify` has no case, or a case with an empty `when` (`API_DIRECT_CLASSIFY_RULES`)                           | `steps.classify: needs cases, each with a check`                                   |
| a `classify` check that names no kind, or several of `absent`, `equals`, `oneOf`, `items`, `keys` and `text`                                | `steps.classify: each check names exactly one kind`                                |
| a `classify` check or capture pointer with no alternative, or an alternative that is not a JSON pointer below the body root                 | `steps.classify: each pointer must be a JSON pointer`                              |
| a `classify` text `pattern` that does not start with `^`, end with `$` and compile alone with the `u` flag                                  | `steps.classify.text.pattern: must be an anchored regex`                           |
| a `classify` text `pattern` with a group, an alternation or a variable repeat before its last atom                                          | `steps.classify.text.pattern: must be a flat regex`                                |
| a `classify` text check or capture whose `maxChars` is not an integer from 1 to 65536                                                       | `steps.classify.maxChars: must be an integer from 1 to 65536`                      |
| a `classify` capture with both `onlyKey` and `integer`                                                                                      | `steps.classify.captures: onlyKey and integer are exclusive`                       |
| a `classify` capture `integer` range with a fractional bound, or a `min` above its `max`                                                    | `steps.classify.captures.integer: must be an integer range`                        |
| a `classify` capture whose slot is the classifier's `into` (`API_DIRECT_CLASSIFY_SLOT_RULES`)                                               | `steps.classify.captures: a slot must not be into`                                 |
| a `classify` `into` or capture slot that the same step writes as an extract, final URL, capture or derivation                               | `steps.classify: slots must not be slots the step also writes`                     |
| a `sessionCarry` slot that is the `into` of some `classify`                                                                                 | `steps.classify.into: must not be a sessionCarry slot`                             |
| a `runIf` whose `carry` some `classify` writes, with a `oneOf` text that no case written to that slot is named                              | `steps.runIf: on a classifier slot, oneOf lists only case names`                   |
| a login or resume step with `mediaType`, off native fetch and node:https                                                                    | `steps.mediaType: not allowed without nativeFetch or node:https`                   |
| a login or resume step with `strictUtf8`, off native fetch and node:https                                                                   | `steps.strictUtf8: not allowed without nativeFetch or node:https`                  |
| `transport.mediaTypes` without `transport.nativeFetch: true`                                                                                | `transport.mediaTypes: not allowed without transport.nativeFetch`                  |
| `transport.strictUtf8` without `transport.nativeFetch: true`                                                                                | `transport.strictUtf8: not allowed without transport.nativeFetch`                  |
| a `transport.mediaTypes` key that is not a response kind (`API_DIRECT_MEDIA_RULES`)                                                         | `transport.mediaTypes: keys must be response kinds`                                |
| a step `mediaType` or `transport.mediaTypes` value that is not one lower-case `type/subtype`, no parameters                                 | `mediaType: must be a lower-case type/subtype`                                     |
| a step `strictUtf8: false` on a bank without `transport.strictUtf8: true` (`API_DIRECT_UTF8_RULES`)                                         | `steps.strictUtf8: false only overrides transport.strictUtf8`                      |

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
is already the final token; only JWT validation may use that index. With
`validation: 'bank-call'` the index must be less than `steps.length`, because
the builder rejects an equal index: the bank-call check needs a step to run.
A fractional or `NaN` index fails the build, because the step walker would
read a missing step and throw instead of failing the warm attempt into the
cold retry. An index above `steps.length` fails it too: it would silently run
no steps, which only a typo produces.

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
the input. `isBadRegex`, beside it, refuses a pattern that does not start with
`^`, end with `$` and compile alone with the `u` flag.

A `textCaptures` pattern cannot be flat, since it takes a group. The build
still refuses a repeated group — `(…)` followed by `*`, `+` or `{`, the shape
of `(a+)+` — once escapes and character classes are stripped. That stops the
worst catastrophic backtracking, not every slow pattern, so capture patterns
stay reviewed config.

`warmStart.kind` says what the stored token is. The default, `'carry'`, seeds
it into the carry slot `carryField`. `'cookie-jar'` is for a cookie-session
bank with no bearer to replay: the token is the session jar itself
([Cookie-jar warm start](session.md#cookie-jar-warm-start)). `'carry-bundle'` is for a
bank whose warm login needs several slots a cold login filled, and optionally
the jar ([Carry-bundle warm start](session.md#carry-bundle-warm-start)).
The warm-start canary (`WarmStartContract`) follows the same policy. It
requires `jwtClaims` only for `'jwt'` validation, and it requires the warm path
to end holding a `token` only when the auth scheme sends a header (`none`
does not). It requires a login step to produce the stored token only when the
token is a carry slot; a cookie-jar token is the session jar itself.
Conflicting transport flags in the transport block are a separate check
(`assertSingleTransport`), run when the transport mediator is wired.

Back to [API-DIRECT-CALL](../api-direct-call.md).
