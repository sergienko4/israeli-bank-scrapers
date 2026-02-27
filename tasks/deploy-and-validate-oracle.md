# Task: Deploy Updated Importer to Oracle + Validate All 3 Banks

## Priority: High | Effort: Small (30 min)

## Current State

- Scraper library v7.0.1 deployed on Oracle (has 403 retry)
- Importer PR #117 ready (Playwright Chromium, remove executablePath, timeout 60s)
- Scraper PR #59 ready (reject executablePath, clear error)
- System Chromium (v145) still in use — causes WAF blocks

## Steps

1. Merge PR #59 (scraper library) → release v7.0.2
2. Merge importer PR #117 → new Docker image with Playwright Chromium
3. Deploy to Oracle
4. Run import — expect all 3 banks (Discount, VisaCal, Amex) to pass
5. Verify 403 retry works for Amex if needed
6. Check Azure as well

## Acceptance Criteria

- [x] Discount scrapes successfully from Oracle ✅
- [x] VisaCal scrapes successfully from Azure ✅ (Oracle IP blocked by VisaCal server)
- [x] Amex scrapes successfully from Azure ✅ (Oracle IP blocked by Amex API)
- [x] No system Chromium in Docker image ✅
- [x] Playwright's bundled Chromium used ✅
- [x] "Unknown error" replaced with descriptive error messages (PR #61) ✅
- [x] Wrong Amex password in Azure credentials.json fixed (40 chars → 20) ✅

## Status: ✅ COMPLETED (2026-02-27)

**Key finding:** Oracle IPs blocked by Amex + VisaCal APIs (IP reputation).
Route Amex + VisaCal to Azure. Discount works from both.
