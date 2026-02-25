# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 6.x     | :white_check_mark: |
| < 6.0   | :x:                |

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
- Dependency review for new/changed dependencies (blocks moderate+ severity, GPL/AGPL licenses)
- npm audit checks for known vulnerabilities (production and dev dependencies)
- OSSF Scorecard analysis (weekly)
- Dependabot automated security updates
- Secret scanning with push protection
- npm provenance attestation on published packages
- All GitHub Actions pinned by commit SHA to prevent supply chain attacks
- CODEOWNERS enforcement for code review
