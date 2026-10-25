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

## Warm start (skipping the SMS)

`result.persistentOtpToken` carries the long-lived `idToken` the identity server
mints. Pass it back as `otpLongTermToken` and the next run re-uses it to mint a
fresh access token, so no SMS is sent.

The same value is also delivered to the `onAuthFlowComplete` callback as
`longTermToken`, which is useful when you want to persist it as soon as login
completes rather than waiting for the scrape to finish.

### Treat it as a standing bypass of your second factor

**This token does not rotate.** A warm run replays the stored value and returns
it unchanged, so the value you store is the one minted by your last SMS login
and it stays valid until the bank expires it — a lifetime measured in years,
not a session.

A token minted against the live bank on 2026-09-19 carried `iat` and `exp`
exactly **3650 days apart — ten years to the second** (`RS256`, expiring
2036-09-16). The scrape that minted it never reads either claim, so the figure
does not come from the E2E run itself: it comes from decoding the cached token
afterwards, which anyone holding a token can repeat without contacting the bank:

```sh
npm run measure:token-lifetime -- onezero
# onezero: iat=2026-09-19T07:59:42.000Z exp=2036-09-16T07:59:42.000Z lifetime=3650 days
```

Treat that as one observation of one token, not a guarantee. It corroborates
the lifetime reported in issue #576 rather than resting on it, but the interval
remains the bank's to change without notice.

Anyone holding the token can skip the SMS step for that entire period, so store
it with the same care as the password itself: encrypted at rest, never in
source control, never in a shared log.

One thing limits the damage: the token alone is not a bearer credential. The
final `/sessions/token` call sends the stored token **and** the account
password, so a leaked token cannot mint a session on its own. It is a bypass of
the SMS factor, not of authentication.

Re-read it from every result and overwrite your copy, so that a run which falls
back to a cold login replaces the stored value with the newly minted one. The
value is redacted from logs and snapshots like any other token.

### One account, one writer

Minting a long-term token revokes the one before it. A stored token replayed
after a later cold login had already minted its replacement drew a `401` from
the identity server carrying
`{"errorResponse":{"type":"ErrorIdTokenRevoke"}}`: the older copy had been
retired the moment the newer one was issued.

That makes a shared account self-defeating. Two processes that each log in — CI
and a developer machine, or two scheduled jobs — invalidate one another's
stored token, and every resulting fallback mints again and revokes again. The
symptom is the one #576 reports, arrived at from the opposite direction: an SMS
on every run, produced by a warm start that is working exactly as designed.

Give each independent runner its own credentials, or let one process own the
login and share the token it stores. Two writers minting against one account
will keep cancelling each other out.

The token is checked for freshness before use. When it has expired — or when it
is a token stored by an earlier version, which persisted a different,
short-lived artifact — the scraper falls back to the full SMS login and returns
a newly minted `persistentOtpToken`. That rejection is made locally, before any
request leaves the process, so the warning says exactly that
(`COLD_FALLBACK_STALE`, "stored long-term token failed the local freshness
check") instead of implying the bank turned it down. No migration step is
needed; the first run after upgrading costs one SMS and heals itself.

A stored token can also pass the freshness check, carry the session, and then be
rejected by the bank mid-run — revoked server-side, or expired against a claim
the scraper does not read. Recovery spends an SMS to repair that and warns too,
so the degradation is never silent.

Both warnings end with the same clause (`COLD_FALLBACK_DETAIL`, "fell back to
the full SMS login"), so a single grep finds every run that paid for an SMS it
was meant to avoid. They name different causes, because the two events are not
the same. `COLD_FALLBACK_STALE` means the stored copy failed the local
freshness check and was never sent — the fault is on this side, and there is no
bank-side request to go looking for. `COLD_FALLBACK_WARM_FAILED` means the
token passed that check and was sent, but the warm attempt did not carry the
session; the attempt's error tag is reported in parentheses. And
`COLD_FALLBACK_DEGRADED` means the token was accepted, carried a session, and
was revoked underneath you.

`COLD_FALLBACK_WARM_FAILED` is deliberately neutral about *why* the warm
attempt failed. The cold retry fires on any failure of the initial prime — a
refusal by the bank, but equally a timeout or a transport error — and those
are indistinguishable once the retry has swallowed them. Calling all
of them "not accepted" would blame your stored token for an outage, so the
scraper reports the attempt's own error tag — `TIMEOUT`, `NETWORK_ERROR` and
so on — instead of guessing which it was.

A WAF block is the one failure that does **not** fall back. The edge refused
the request before OneZero saw it, so a cold login from the same runtime would
meet the same refusal and could spend an SMS doing it. The run fails with
`WAF_BLOCKED` instead — see [What happens when the edge refuses](#what-happens-when-the-edge-refuses).

Only the tag is reported, never the failure text. Banks echo credentials into
error messages, so putting that text in an operator-facing log is exactly the
cleartext-logging leak `redactErrorMessage` exists to prevent; password-class
tags are themselves credential metadata and are redacted in turn.

A mid-run rejection is repaired wherever it surfaces. Any API call that comes
back `401`/`403` re-mints in place and retries — unless the `403` is a
Cloudflare refusal, which is terminal (see
[What happens when the edge refuses](#what-happens-when-the-edge-refuses)) —
and that in-request repair
re-surfaces the newly minted token through `onAuthFlowComplete` exactly as an
explicit recovery does. Without that, the replacement token would exist only for
the remainder of the process: your stored copy would keep the dead value and the
next run would pay for another SMS — the original #576 symptom, reached by a
different route.

> Earlier versions persisted an artifact that expired about an hour after the original
> SMS login and was never refreshed, so warm start appeared to work and then
> quietly reverted to sending an SMS on every run ([#576][issue-576]).

[issue-576]: https://github.com/sergienko4/israeli-bank-scrapers/issues/576

## Transport — what the Cloudflare edge requires

The OneZero identity (`identity.tfd-bank.com`) and GraphQL
(`mobile.tfd-bank.com`) hosts sit behind Cloudflare. A request reaches OneZero
only when it looks like the OneZero Android app on **all three** of the
following. Miss any one and the edge answers `403` with a Cloudflare
"Attention Required" block page:

| Requirement        | What the scraper sends                                                                         | Where it lives                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Client certificate | The app-level OneZero certificate (mutual TLS) — see [Client certificate](#client-certificate) | `src/Scrapers/Pipeline/Strategy/Fetch/Mtls/OneZeroClientCert.ts`                                     |
| TLS fingerprint    | A ClientHello matching the app's OkHttp stack on Android 11 (`android-11-okhttp`)              | `src/Scrapers/Pipeline/Strategy/Fetch/Tls/TlsClientProfiles.ts`                                      |
| User-Agent         | The app's User-Agent, on identity **and** GraphQL calls                                        | `ONEZERO_USER_AGENT` in `src/Scrapers/Pipeline/Registry/Config/PipelineBankConfigOneZeroHeadless.ts` |

The fingerprint is a property of the TLS handshake itself — cipher and
signature-algorithm order, curves, extensions — so no header, cookie or
user-agent change can stand in for it. Every OneZero request goes through one
`node:https` agent that carries both the certificate and the profile
(`MtlsTransport`).

### Runtime requirement — OpenSSL 3.5 or later

Only OpenSSL 3.5 or later can produce the app's ClientHello. Node bundles it
from **22.20** on the 22.x line, from **24.5** on the 24.x line, and in every
25.x and 26.x release. Earlier runtimes ship OpenSSL 3.0, whose handshake
differs in ways the profile cannot override, so the edge blocks them even with
the profile applied.

Check yours with:

```bash
node -p process.versions.openssl
```

On an older runtime the scraper logs a `WARN` when it builds the OneZero
transport — `[tls] runtime OpenSSL cannot emit this TLS profile; the bank edge
may block requests`, with the profile, the detected version and the minimum —
and the login then fails with `WAF_BLOCKED`.

### What happens when the edge refuses

A `4xx` Cloudflare block page is reported as `WAF_BLOCKED`, not `GENERIC`:

```text
POST https://identity.tfd-bank.com/v1/devices/token 403: blocked by Cloudflare edge (WAF) before reaching the API
```

So is a Cloudflare challenge — any response carrying Cloudflare's
`cf-mitigated: challenge` header, whatever its status — which no API client
can solve; its message ends `challenged by Cloudflare edge (WAF) before
reaching the API`.

The page itself is never quoted — it carries your client IP and a Cloudflare
Ray ID — and this path sets no `errorDetails`. `WAF_BLOCKED` is terminal:
the call is not retried, a blocked warm start does not fall back to an SMS
login, a block on a later accounts or balance call does not trigger a re-login,
and the balance is never reported as `0` in its place.

Work through these in order:

1. **Runtime** — confirm OpenSSL 3.5 or later (above).
2. **Package version** — upgrade. The edge accepts what the current app sends,
   so a OneZero app release can retire the fingerprint or User-Agent shipped
   here.

When the app's network stack changes, update `ONEZERO_USER_AGENT` for the new
app version, and register a new profile in `TlsClientProfiles.ts` with its
expected JA4 hash and OpenSSL floor. `TlsClientProfilesJa4.test.ts` captures
the ClientHello the profile really emits and asserts it hashes to that JA4
exactly on runtimes at or above the floor, so a profile that drifts from its
target fails in CI rather than at the edge.

The transport is not specific to OneZero. A bank's headless config opts in with
`tlsProfile` (a `TlsClientProfileKind`), `requiresClientCert`, or both; either
one moves its identity and GraphQL calls onto `node:https`. When the transport
is built, `getTlsClientProfile` resolves the profile's ClientHello options,
`resolveClientCert` looks up the bank's certificate in `ClientCertRegistry.ts`
(failing fast when none is registered), and `warnIfTlsProfileUnsupported`
logs the OpenSSL warning above whenever `isTlsProfileSupported` finds the
runtime below the profile's floor.

### Server certificate checks

The Android profile lowers OpenSSL's security level to 0 so that its
ClientHello still offers `rsa_pkcs1_sha1`, as the app does. OpenSSL applies
the same level when it verifies the server's certificate chain, so the
transport restores those checks itself. `buildMtlsAgent` sets
`checkServerCertificate` as the `checkServerIdentity` of every agent it builds,
whatever the profile. After Node's standard hostname check,
`isServerChainAboveFloor` requires 112-bit strength — OpenSSL security level 2
— from every certificate in the chain the server presented:

- **Keys:** RSA of at least 2048 bits, DSA with at least a 2048-bit modulus
  and a 224-bit subgroup order, EC on a named curve of at least 224 bits, or
  Ed25519/Ed448. Any other key type is refused.
- **Signatures:** RSA or ECDSA with SHA-2, EdDSA, or RSASSA-PSS naming a SHA-2
  hash. `readSignatureAlgorithm` reads the algorithm from the certificate's
  DER, and a certificate it cannot read is refused. A self-signed root's own
  signature is not checked, because it carries no trust; its key is.

A chain below the floor ends the connection before any request byte — or any
credential — is written. The call fails as `GENERIC`, its message ending in
`SERVER_CERT_FLOOR_REASON`, which names no host or certificate field:

```text
POST https://identity.tfd-bank.com/v1/devices/token mtls error: server certificate chain is below the TLS security floor (weak key or signature)
```

OneZero's own chain (ECDSA P-256 with SHA-256 and SHA-384 signatures) clears
the floor. This error therefore means the connection did not reach OneZero
directly: look for a proxy or TLS-inspecting middlebox that re-signs traffic
with its own certificate.

The floor covers certificates only. Under TLS 1.2 a server may still sign the
handshake itself with `rsa_pkcs1_sha1`, which the profile offers to match the
app; TLS 1.3, which the OneZero edge negotiates, forbids it.

### Client certificate

The scraper presents a client certificate on every OneZero request.
Resolution:

| Step | Source                                   | Notes                                                                                                                                                                        |
| ---- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `ONEZERO_MTLS_CERT` + `ONEZERO_MTLS_KEY` | Inline PEM **or** a filesystem path to a PEM file. A value containing `-----BEGIN` is treated as inline PEM; anything else is read from disk. **Both must be set together.** |
| 2    | Bundled base64 default                   | The app-shared certificate extracted from the public OneZero APK. Used **only when neither override is set**.                                                                |

```bash
# Inline PEM
export ONEZERO_MTLS_CERT="$(cat client.crt)"
export ONEZERO_MTLS_KEY="$(cat client.key)"

# …or a path
export ONEZERO_MTLS_CERT=/etc/onezero/client.crt
export ONEZERO_MTLS_KEY=/etc/onezero/client.key
```

**Fail closed.** Configuring an override is a statement of intent, so a broken
one is an error rather than a hint. Initialization throws when only one half of
the pair is set, when either value is unreadable or is not PEM, or when the key
does not match the certificate. It never silently falls back to the bundled
identity — a typo'd path or a failed secret mount would otherwise send
production traffic under a credential you never chose, and the resulting `403`
would be indistinguishable from a WAF block.

**Security.** A private key is confidential material and is handled as such: it
is never logged, and diagnostics carry only the env-var _name_ and the
days-to-expiry. The bundled key is not user PII and not a per-user secret — it
is a shared _application_ credential identifying the OneZero mobile client
rather than the account holder, and is already extractable from the public APK,
which is what lets the scraper work out of the box. Being public does not make
it non-confidential: a key you supply via the overrides above is a real secret,
so keep it in your secret store and mount it read-only.

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
