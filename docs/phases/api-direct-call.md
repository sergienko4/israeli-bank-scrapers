# API-DIRECT-CALL

Authentication over HTTP for every bank. A declarative step list handles
login, OTP, session cookies and any HTML/script responses that need parsing;
no page or browser engine is created. This is the first of the two pipeline
phases, followed by [API-DIRECT-SCRAPE](api-direct-scrape.md).

|                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Always-on?**  | All banks                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Owner slots** | `apiMediator`, `durableAuth`; diagnostics record the authentication outcome                                                                                                                                                                                                                                                                                                                                                                                                |
| **Source**      | [`ApiDirectCallPhase.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectCall/ApiDirectCallPhase.ts) + [`ApiDirectCallActions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.ts) + [`Flow/`](https://github.com/sergienko4/israeli-bank-scrapers/tree/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/ApiDirectCall/Flow) |

## In this section

| Part                                       | What it covers                                                      |
| ------------------------------------------ | ------------------------------------------------------------------- |
| [Overview](api-direct-call/overview.md)    | Shared primitives, step model, sub-step contract                    |
| [Flow](api-direct-call/flow.md)            | Queries, URLs, extracts, credentials, carry generators              |
| [Signing](api-direct-call/signing.md)      | Signer, body templates, crypto hook, phone form, device certificate |
| [Codecs](api-direct-call/codecs.md)        | Answer classifier, extract rules, AES envelope codec                |
| [Captures](api-direct-call/captures.md)    | Text, form, script, SDK, serialized JSON and JWT captures           |
| [Session](api-direct-call/session.md)      | Session carry, cookie hand-off, transport fields, warm starts       |
| [Auth policy](api-direct-call/auth.md)     | OTP guards, one-SMS budget, header policy, durable device auth      |
| [Errors](api-direct-call/errors.md)        | Bank text, outcome, error guards, HTTP map, failure modes           |
| [Config checks](api-direct-call/checks.md) | Build-time validators for a bank config                             |

## Legacy anchors

Saved deep links from the pre-split page land here and point at the part that now owns the section.

- <a id="unified-api-direct-primitives"></a>[Unified api-direct primitives](api-direct-call/overview.md#unified-api-direct-primitives)
- <a id="signer-discriminated-union"></a>[Signer (discriminated union)](api-direct-call/signing.md#signer-discriminated-union)
- <a id="jsonvaluetemplate"></a>[JsonValueTemplate](api-direct-call/signing.md#jsonvaluetemplate)
- <a id="carry-derivation"></a>[Carry derivation](api-direct-call/flow.md#carry-derivation)
- <a id="cryptofield-pre-hook"></a>[CryptoField pre-hook](api-direct-call/signing.md#cryptofield-pre-hook)
- <a id="phone-normaliser"></a>[Phone normaliser](api-direct-call/signing.md#phone-normaliser)
- <a id="get-steps"></a>[GET steps](api-direct-call/overview.md#get-steps)
- <a id="step-headers"></a>[Step headers](api-direct-call/overview.md#step-headers)
- <a id="raw-query"></a>[Raw query](api-direct-call/flow.md#raw-query)
- <a id="carried-step-url"></a>[Carried step URL](api-direct-call/flow.md#carried-step-url)
- <a id="final-url-carry"></a>[Final URL carry](api-direct-call/flow.md#final-url-carry)
- <a id="optional-extracts"></a>[Optional extracts](api-direct-call/flow.md#optional-extracts)
- <a id="required-credentials"></a>[Required credentials](api-direct-call/flow.md#required-credentials)
- <a id="bank-text-in-failures"></a>[Bank text in failures](api-direct-call/errors.md#bank-text-in-failures)
- <a id="step-outcome"></a>[Step outcome](api-direct-call/errors.md#step-outcome)
- <a id="bank-error-guard"></a>[Bank-error guard](api-direct-call/errors.md#bank-error-guard)
- <a id="http-failure-map"></a>[HTTP failure map](api-direct-call/errors.md#http-failure-map)
- <a id="answer-classifier"></a>[Answer classifier](api-direct-call/codecs.md#answer-classifier)
- <a id="extract-rules"></a>[Extract rules](api-direct-call/codecs.md#extract-rules)
- <a id="text-captures"></a>[Text captures](api-direct-call/captures.md#text-captures)
- <a id="login-form-capture"></a>[Login-form capture](api-direct-call/captures.md#login-form-capture)
- <a id="handoff-script-capture"></a>[Handoff script capture](api-direct-call/captures.md#handoff-script-capture)
- <a id="sdk-reference-capture"></a>[SDK reference capture](api-direct-call/captures.md#sdk-reference-capture)
- <a id="serialized-script-json-capture"></a>[Serialized script JSON capture](api-direct-call/captures.md#serialized-script-json-capture)
- <a id="issued-jwt-claim-binding"></a>[Issued JWT claim binding](api-direct-call/captures.md#issued-jwt-claim-binding)
- <a id="envelope-codec"></a>[Envelope codec](api-direct-call/codecs.md#envelope-codec)
- <a id="conditional-steps"></a>[Conditional steps](api-direct-call/overview.md#conditional-steps)
- <a id="carry-generators"></a>[Carry generators](api-direct-call/flow.md#carry-generators)
- <a id="device-certificate"></a>[Device certificate](api-direct-call/signing.md#device-certificate)
- <a id="session-carry"></a>[Session carry](api-direct-call/session.md#session-carry)
- <a id="cookie-hand-off"></a>[Cookie hand-off](api-direct-call/session.md#cookie-hand-off)
- <a id="otp-pre-hook-guards"></a>[OTP pre-hook guards](api-direct-call/auth.md#otp-pre-hook-guards)
- <a id="session-transport-fields"></a>[Session-transport fields](api-direct-call/session.md#session-transport-fields)
- <a id="build-time-config-checks"></a>[Build-time config checks](api-direct-call/checks.md#build-time-config-checks)
- <a id="cookie-jar-warm-start"></a>[Cookie-jar warm start](api-direct-call/session.md#cookie-jar-warm-start)
- <a id="carry-bundle-warm-start"></a>[Carry-bundle warm start](api-direct-call/session.md#carry-bundle-warm-start)
- <a id="transport-errors"></a>[Transport errors](api-direct-call/errors.md#transport-errors)
- <a id="step-names-and-url-tags"></a>[Step names and URL tags](api-direct-call/overview.md#step-names-and-url-tags)
- <a id="password-only-chains"></a>[Password-only chains](api-direct-call/overview.md#password-only-chains)
- <a id="one-sms-per-run"></a>[One SMS per run](api-direct-call/auth.md#one-sms-per-run)
- <a id="why-it-needed-enforcing"></a>[Why it needed enforcing](api-direct-call/auth.md#why-it-needed-enforcing)
- <a id="what-changed-for-callers"></a>[What changed for callers](api-direct-call/auth.md#what-changed-for-callers)
- <a id="auth-mode-policy"></a>[Auth-mode policy](api-direct-call/auth.md#auth-mode-policy)
- <a id="auth-recovery"></a>[Auth recovery](api-direct-call/auth.md#auth-recovery)
- <a id="persistent-durable-device-auth"></a>[Persistent (durable) device auth](api-direct-call/auth.md#persistent-durable-device-auth)
- <a id="device-memory"></a>[Device memory](api-direct-call/auth.md#device-memory)
- <a id="sub-step-contract"></a>[Sub-step contract](api-direct-call/overview.md#sub-step-contract)
- <a id="failure-modes"></a>[Failure modes](api-direct-call/errors.md#failure-modes)

## Reading paths

- **New to the phase:** [Overview](api-direct-call/overview.md) → [Flow](api-direct-call/flow.md) → [Signing](api-direct-call/signing.md).
- **Debugging a run:** [Errors](api-direct-call/errors.md) → [Codecs](api-direct-call/codecs.md) → [Captures](api-direct-call/captures.md).
- **Adding or changing a bank:** [Overview](api-direct-call/overview.md) → [Flow](api-direct-call/flow.md) → [Config checks](api-direct-call/checks.md).
