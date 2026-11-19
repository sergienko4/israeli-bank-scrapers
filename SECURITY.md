# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 10.x    | :white_check_mark: |
| 9.x     | :white_check_mark: |
| 8.x     | :x:                |
| < 8.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please use one of the following methods:

1. **GitHub Security Advisories (preferred):** Navigate to the
   [Security Advisories](https://github.com/sergienko4/israeli-bank-scrapers/security/advisories/new)
   page and create a new advisory.

2. **Email:** Send details to the repository maintainer via the email
   listed on their GitHub profile.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix or mitigation:** Depends on severity, targeting 30 days for critical issues

## Security Measures

This project employs the following security measures:

- CodeQL static analysis with `security-extended` query suite on every pull request
- Dependency review for new/changed third-party dependencies (blocks moderate+ severity, GPL/AGPL dependency licenses)
- npm audit checks for known vulnerabilities (production and dev dependencies)
- OSSF Scorecard analysis (weekly)
- Dependabot automated security updates
- Secret scanning with push protection
- npm provenance attestation on published packages
- All GitHub Actions pinned by commit SHA to prevent supply chain attacks
- CODEOWNERS enforcement for code review

The dependency-license policy is separate from this fork's own
`PolyForm-Noncommercial-1.0.0` license. Third-party components retain their
existing licenses; the project's license change does not relax the dependency
allowlist.

The dependency-review gate allowlists a few packages whose license metadata its
scanner cannot map to an SPDX identifier, for example `gitdb`, which ships a
GPL-licensed helper file alongside its BSD-3-Clause code. The gate therefore
does not reject every dependency that contains GPL material. The exceptions
are listed, with the verified upstream license of each, in the
`allow-dependencies-licenses` input of the dependency-review job in
[`.github/workflows/pr.yml`](./.github/workflows/pr.yml).

## Shipped bank-protocol material

The library speaks each bank's own mobile or web protocol, so some of that
protocol's cryptography and application identifiers ship in the source. Each
use below is deliberate and documented at its call site. The library never
stores or hashes a consumer password, and this material is never used to
decide whether a scrape result is trustworthy. A bank's own envelope may
encrypt a password field for that request; that is wire encoding the protocol
requires, not password storage and not a replacement for TLS.

### OneZero client certificate

OneZero's `*.tfd-bank.com` hosts require the Android app's mutual-TLS client
certificate. That certificate and key are application-level material extracted
from the public APK: they identify the OneZero app, not the account holder, and
rotate roughly annually. The key ships base64-wrapped so the package works out
of the box.

Set `ONEZERO_MTLS_CERT` and `ONEZERO_MTLS_KEY` (inline PEM or a path to a PEM
file) to replace both halves on rotation or in a private deployment. Setting
only one, or a broken value, fails closed instead of falling back to the
bundled identity. A key supplied through the overrides is a real secret and
belongs in a secret store. See
[OneZero — client certificate](./docs/banks/onezero.md#client-certificate).

### Protocol-mandated weak primitives

Some bank protocols require algorithms that would not be chosen for a new
design. They are accepted only where the bank's wire format demands them.

| Primitive      | Where                                                           | Role                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SHA-1 with RSA | Yahav PKCS#10 certificate request (`pkcs10-csr`)                | Signs the enrollment CSR the bank's server expects. The signature authenticates the request; it does not protect TLS and is not a password hash.                                                           |
| MD5            | Telebank family (Discount, Mercantile) `uidMd5`                 | The API requires the MD5 of the composed user id. It is a request field, not a credential hash; the password is sealed separately under the bank's RSA key.                                                |
| AES-256-CBC    | PayBox request signer; Leumi and FIBI-family Transmit envelopes | Encrypts or signs protocol fields, including password-bearing login bodies, in the shape the bank's own client sends. Keys are per-session or per-bank material, never derived from the consumer password. |

Transport confidentiality and integrity come from TLS. These primitives exist
to satisfy the bank's server; when an envelope encrypts a login body it is an
additional wire format, not password storage. A failure in one of them cannot
make an untrustworthy scrape result look successful.

### Pepper device name

Pepper's Transmit fingerprint includes a `device_name`. It is derived per user
from the account's `phoneNumber` as a stable 16-character prefix of its SHA-256
digest, so two accounts no longer present the same captured device identifier.
The value is an identifier, not a secrecy control: phone numbers are
low-entropy, and the fingerprint travels to the bank during login.
