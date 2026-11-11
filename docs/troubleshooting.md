# Troubleshooting

Every bank uses HTTP. Browser launch, binary-cache and Playwright patch errors
belong to older releases; see [Compatibility](compatibility.md) when upgrading.

## `WAF_BLOCKED`

The bank's edge rejected a request or returned a challenge before the API
could answer. This package has no browser fallback and cannot solve an
interactive CAPTCHA.

| Scenario                                                      | Action                                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Repeated requests or parallel sessions are blocked            | Wait before retrying and reduce scrape frequency or concurrency                                                             |
| `blocked by Cloudflare edge (WAF) before reaching the API`    | The edge refused the client identity or TLS fingerprint; see [OneZero](banks/onezero.md#what-happens-when-the-edge-refuses) |
| `challenged by Cloudflare edge (WAF) before reaching the API` | The edge returned a challenge; stop retrying immediately and wait                                                           |

Read `errorMessage` for the failed call and status. Cloudflare/WAF refusals do
not attach `errorDetails`.

## `server certificate chain is below the TLS security floor`

The `node:https` transport refused a weak server certificate chain before
sending the request. A TLS-inspecting proxy or middlebox may have presented
its own certificate. Route around it rather than disabling verification.
See [Server certificate checks](banks/onezero.md#server-certificate-checks).

## `server negotiated a TLS version the profile does not allow`

The server negotiated a protocol outside the bank's TLS profile. OneZero
pins TLS 1.3; a TLS-inspecting middlebox can interfere with that negotiation.
See [Session protocol](banks/onezero.md#session-protocol).

## Error types

Returned as `result.errorType` when `result.success` is `false`.

| Error                          | Meaning                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `INVALID_PASSWORD`             | Wrong credentials                                                         |
| `INVALID_OTP`                  | Wrong or expired OTP code                                                 |
| `TWO_FACTOR_RETRIEVER_MISSING` | OTP required but no callback supplied                                     |
| `INVALID_PHONE_NUMBER`         | Invalid bank-specific phone format; see [Configuration](configuration.md) |
| `CHANGE_PASSWORD`              | The bank requires a password change through its own site                  |
| `ACCOUNT_BLOCKED`              | The bank locked the account                                               |
| `WAF_BLOCKED`                  | Edge block or challenge; context is in `errorMessage`                     |
| `TIMEOUT`                      | The HTTP request exceeded its deadline                                    |
| `NETWORK_ERROR`                | Transport failure reaching the bank                                       |
| `GENERIC`                      | Pipeline failure; read `errorMessage`                                     |

## Request deadlines

The native HTTP transport caps requests, including required response-body
reads, with `timeoutMs`; its shared default is `NETWORK_FETCH_TIMEOUT_MS`
(30 seconds). Connection retry and redirect policies are separate concerns;
see [HTTP transports](architecture/pipeline.md#http-transports).
`defaultTimeout` is removed and cannot change an HTTP request budget.
Use `otpTimeoutMs` for the OTP callback, not an HTTP deadline.

## Still stuck?

Capture the relevant run with `FORENSIC_TRACE=true` and attach `pipeline.log`
and the relevant `network/*.json` files. Keep `PII_REDACTION=on` and inspect
the files before sharing. There are no DOM snapshots or PNG screenshots.
See [PII redaction](observability/redaction.md).

!!! danger "Artifacts captured with redaction off are private"
`PII_REDACTION=off` leaves account data and authentication material in
captures. Do not attach those files publicly; reproduce with redaction on.
