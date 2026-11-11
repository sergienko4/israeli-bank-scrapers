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

## Reading paths

- **New to the phase:** [Overview](api-direct-call/overview.md) → [Flow](api-direct-call/flow.md) → [Signing](api-direct-call/signing.md).
- **Debugging a run:** [Errors](api-direct-call/errors.md) → [Codecs](api-direct-call/codecs.md) → [Captures](api-direct-call/captures.md).
- **Adding or changing a bank:** [Overview](api-direct-call/overview.md) → [Flow](api-direct-call/flow.md) → [Config checks](api-direct-call/checks.md).
