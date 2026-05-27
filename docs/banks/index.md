# Banks

> **Who this is for:** users picking the right `CompanyTypes` for their bank and looking up credentials, OTP behavior, or known quirks.

19 institutions are supported. **14 are on the Pipeline architecture** (recommended), **5 are on the legacy path** (still ship, on the migration roadmap).

## Quick directory

<div class="grid cards" markdown>

-   :material-bank: **Banks (browser engine)**

    [Bank Hapoalim](hapoalim.md) · [Beinleumi](beinleumi.md) · [Discount](discount.md) · [Massad](massad.md) · [Mercantile](mercantile.md) · [Otsar Hahayal](otsar-hahayal.md) · [Pagi](pagi.md)

-   :material-credit-card: **Credit cards (browser engine)**

    [Amex](amex.md) · [Isracard](isracard.md) · [Max](max.md) · [Visa Cal](visacal.md)

-   :material-api: **API-direct (no browser)**

    [OneZero](onezero.md) · [Pepper](pepper.md) · [PayBox](paybox.md)

-   :material-archive: **Legacy (deprecated)**

    [Behatsdaa](behatsdaa.md) · [Beyahad Bishvilha](beyahad-bishvilha.md) · [Bank Leumi](leumi.md) · [Mizrahi Bank](mizrahi.md) · [Bank Yahav](yahav.md)

</div>

## Pipeline-backed banks (14) — credentials at a glance

| Bank | `CompanyTypes` | Credential fields | OTP |
|---|---|---|---|
| Amex | `Amex` | `id`, `card6Digits`, `password` | — |
| Bank Hapoalim | `Hapoalim` | `userCode`, `password` | conditional |
| Beinleumi | `Beinleumi` | `username`, `password` | required |
| Discount Bank | `Discount` | `id`, `password`, `num` | — |
| Isracard | `Isracard` | `id`, `card6Digits`, `password` | — |
| Massad | `Massad` | `username`, `password` | required |
| Max | `Max` | `username`, `password` | — |
| Mercantile Bank | `Mercantile` | `id`, `password`, `num` | — |
| One Zero | `OneZero` | `email`, `password` | required (API) |
| Otsar Hahayal | `OtsarHahayal` | `username`, `password` | required |
| Pagi | `Pagi` | `username`, `password` | required |
| PayBox | `PayBox` | `phoneNumber` | required (API) |
| Pepper | `Pepper` | `phoneNumber`, `password` | required (API) |
| Visa Cal | `VisaCal` | `username`, `password` | — |

## Legacy banks (5) — credentials at a glance

| Bank | `CompanyTypes` | Credential fields | OTP |
|---|---|---|---|
| Behatsdaa | `Behatsdaa` | `id`, `password` | — |
| Beyahad Bishvilha | `BeyahadBishvilha` | `id`, `password` | — |
| Bank Leumi | `Leumi` | `username`, `password` | — |
| Mizrahi Bank | `Mizrahi` | `username`, `password` | — |
| Bank Yahav | `Yahav` | `username`, `nationalID`, `password` | — |

Source: [`src/Definitions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Definitions.ts).

## How to pick the right page

| If you... | Read |
|---|---|
| ... just want to scrape with code that works today | The per-bank page for credential fields, then [Quick Start](../quick-start.md) |
| ... want to know which engine your bank uses (browser vs API) | The per-bank page's "Engine" line |
| ... hit `INVALID_OTP` or `INVALID_PASSWORD` | The per-bank "Known quirks" section + [Phases → LOGIN](../phases/login.md) / [OTP-FILL](../phases/otp-fill.md) |
| ... see `WAF_BLOCKED` | The per-bank page (in case of bank-specific quirks) + [Error Types → WAF](https://github.com/sergienko4/israeli-bank-scrapers#error-types) |
