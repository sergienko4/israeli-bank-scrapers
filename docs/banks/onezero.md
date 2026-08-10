# One Zero

|                |                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `OneZero`                                                                                                                                                        |
| Engine         | **API-direct** (no browser)                                                                                                                                      |
| Credentials    | `email`, `password` (plus `phoneNumber`, `otpCodeRetriever`, optional `otpLongTermToken`)                                                                        |
| OTP            | Required (or `otpLongTermToken` from a previous run)                                                                                                             |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                            |
| Phone format   | `international-plus` (`+972000000000`)                                                                                                                           |
| Source         | [`Banks/OneZero/OneZeroPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/OneZero/OneZeroPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  email: 'user@example.com',
  password: 'mypassword',
  phoneNumber: '+972000000000', // international-plus (with +)
  otpCodeRetriever: async () => await myInbox.getCode(),
});

// Save result.persistentOtpToken — pass as otpLongTermToken on next run to skip SMS
```

## Transport — Cloudflare mutual TLS (mTLS)

The OneZero identity + GraphQL endpoints sit behind **Cloudflare API Shield**, which
requires a **client certificate** on the TLS handshake. A request without one is
rejected at the transport layer with `403` and a Cloudflare block page — no
application-layer header, cookie, or user-agent change can satisfy it.

The scraper therefore presents a client certificate on every OneZero request
(`MtlsTransport` over `node:https`). Resolution order, per part:

| Step | Source                                   | Notes                                                                                                                                                                      |
| ---- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `ONEZERO_MTLS_CERT` / `ONEZERO_MTLS_KEY` | Inline PEM **or** a filesystem path to a PEM file. A value containing `-----BEGIN` is treated as inline PEM; anything else is read from disk.                              |
| 2    | Bundled base64 default                   | The app-shared certificate extracted from the public OneZero APK. Used when no override is set, or when an override is unreadable/invalid (logged as `WARN`, never fatal). |

```bash
# Inline PEM
export ONEZERO_MTLS_CERT="$(cat client.crt)"
export ONEZERO_MTLS_KEY="$(cat client.key)"

# …or a path
export ONEZERO_MTLS_CERT=/etc/onezero/client.crt
export ONEZERO_MTLS_KEY=/etc/onezero/client.key
```

**Security note.** The bundled key is a shared _application_ credential that
identifies the OneZero mobile client — not the account holder. It is not user
PII, not a per-user secret, and is already publicly extractable from the APK;
shipping it is what lets the scraper work out of the box. Deployments that need
their own identity supply the overrides above. Certificate and key contents are
never logged — only the env-var _name_ appears in diagnostics.

**Rotation.** The certificate is valid roughly one year. A `WARN` is emitted when
it is within 30 days of expiry (`near expiry — rotate soon`) and a distinct
`WARN` once it has passed (`EXPIRED — rotate now`), so rotation is visible
_before_ the gate starts returning `403`. Rotate by re-extracting from a current
APK release and updating the bundled default, or by setting the env overrides.

**Timeouts.** Each mTLS request is bounded by a 30 s deadline
(`MTLS_REQUEST_TIMEOUT_MS`) covering connect, headers, and body. A hung socket or
a body truncated mid-stream is surfaced as a retryable network failure rather
than leaving the request pending.

## Known quirks

- GraphQL API throughout — `GET_ACCOUNT_TRANSACTIONS` + `GET_ACCOUNT_BALANCE` queries.
- Persistent OTP token returned on successful login — opt-in long-lived auth for headless re-runs.
- The poll interval was bumped past an undocumented API throttle in v8.4.x (see `fix(telegram-otp): bump poll interval past undocumented API throttle`).
