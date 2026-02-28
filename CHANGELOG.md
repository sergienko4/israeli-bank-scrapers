# Changelog

## [7.3.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.2.0...v7.3.0) (2026-02-28)


### Features

* **e2e:** add Beinleumi OTP-screen CI test ([#67](https://github.com/sergienko4/israeli-bank-scrapers/issues/67)) ([ba67f00](https://github.com/sergienko4/israeli-bank-scrapers/commit/ba67f0075e2db9a7128f72a39096bedcdeb6604e))

## [7.2.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.1.0...v7.2.0) (2026-02-28)


### Features

* add TypeDoc auto-docs published to GitHub Pages ([#68](https://github.com/sergienko4/israeli-bank-scrapers/issues/68)) ([173ddfc](https://github.com/sergienko4/israeli-bank-scrapers/commit/173ddfcf6d24be8c8d65f1d6300d2bbf6c15cb43))

## [7.1.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.0.3...v7.1.0) (2026-02-28)


### Features

* resilient login field detection — 4-round selector fallback + bank registry ([#63](https://github.com/sergienko4/israeli-bank-scrapers/issues/63)) ([d67a59f](https://github.com/sergienko4/israeli-bank-scrapers/commit/d67a59f0b44af42c10f610778049ead24e9c6b07))


### Bug Fixes

* **e2e:** replace broken Beinleumi MATAF test with Massad ([#65](https://github.com/sergienko4/israeli-bank-scrapers/issues/65)) ([947f8f3](https://github.com/sergienko4/israeli-bank-scrapers/commit/947f8f3ba7af17814853196d84a50d5740955dc8))
* **visa-cal:** increase getCards session storage timeout 10s → 30s ([#66](https://github.com/sergienko4/israeli-bank-scrapers/issues/66)) ([a8fc4e5](https://github.com/sergienko4/israeli-bank-scrapers/commit/a8fc4e572c363dcf9ee99e2f70c894aca9d8efe1))

## [7.0.3](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.0.2...v7.0.3) (2026-02-27)


### Bug Fixes

* surface network errors in fetchPostWithinPage and fix Amex login diagnostics ([#61](https://github.com/sergienko4/israeli-bank-scrapers/issues/61)) ([4da69dd](https://github.com/sergienko4/israeli-bank-scrapers/commit/4da69dd4a5738a0cb4d76813c2dce709cabbb4a3))

## [7.0.2](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.0.1...v7.0.2) (2026-02-26)


### Bug Fixes

* throw error browser version mismatches Playwright's expected Chromium ([#59](https://github.com/sergienko4/israeli-bank-scrapers/issues/59)) ([a15b018](https://github.com/sergienko4/israeli-bank-scrapers/commit/a15b01843f7e4c31612069bf7b38432473d700e2))

## [7.0.1](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.0.0...v7.0.1) (2026-02-26)


### Bug Fixes

* add 403 retry with 15s delay for WAF-blocked datacenter IPs ([#57](https://github.com/sergienko4/israeli-bank-scrapers/issues/57)) ([98eadd7](https://github.com/sergienko4/israeli-bank-scrapers/commit/98eadd70d318a66574cb4a3328d10a4e1ee66ba7))

## [7.0.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.9.2...v7.0.0) (2026-02-26)


### ⚠ BREAKING CHANGES

* browser/browserContext/preparePage options now expect Playwright types. getPuppeteerConfig() removed.

### Features

* migrate from Puppeteer to Playwright ([#54](https://github.com/sergienko4/israeli-bank-scrapers/issues/54)) ([4974e0f](https://github.com/sergienko4/israeli-bank-scrapers/commit/4974e0f1e49fd4545ac01249df0f23ef2dafd93f))

## [6.9.2](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.9.1...v6.9.2) (2026-02-26)


### Bug Fixes

* CodeQL incomplete-sanitization in max.ts + enable Discount in CI ([#52](https://github.com/sergienko4/israeli-bank-scrapers/issues/52)) ([dccf481](https://github.com/sergienko4/israeli-bank-scrapers/commit/dccf481df80b1569d4175fe6bcbf0abcd4d37b6c))

## [6.9.1](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.9.0...v6.9.1) (2026-02-26)


### Bug Fixes

* bypass Cloudflare WAF for Amex/Isracard with retry + manual stealth ([dd3a6a1](https://github.com/sergienko4/israeli-bank-scrapers/commit/dd3a6a18f50757517000f2341d4ea892e23bb752))
* bypass Cloudflare WAF for Amex/Isracard with retry + manual stealth ([#49](https://github.com/sergienko4/israeli-bank-scrapers/issues/49)) ([dd3a6a1](https://github.com/sergienko4/israeli-bank-scrapers/commit/dd3a6a18f50757517000f2341d4ea892e23bb752))

## [6.9.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.8.2...v6.9.0) (2026-02-25)


### Features

* integrate puppeteer-extra-plugin-stealth for enhanced anti-detection ([#47](https://github.com/sergienko4/israeli-bank-scrapers/issues/47)) ([fadb0dc](https://github.com/sergienko4/israeli-bank-scrapers/commit/fadb0dc7362aaf3a9c85955a82d0c813e2ec9425))

## [6.8.2](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.8.1...v6.8.2) (2026-02-25)


### Bug Fixes

* resolve Jest 30 test-exclude crash on Node 22 ([#45](https://github.com/sergienko4/israeli-bank-scrapers/issues/45)) ([e146bf2](https://github.com/sergienko4/israeli-bank-scrapers/commit/e146bf2529f015c9010050127b829d35dd4b217c))

## [6.8.1](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.8.0...v6.8.1) (2026-02-25)


### Bug Fixes

* replace node-fetch with native fetch() API ([#41](https://github.com/sergienko4/israeli-bank-scrapers/issues/41)) ([9e12cef](https://github.com/sergienko4/israeli-bank-scrapers/commit/9e12cefd260c5890d0ea35c0f995160badf07fd6))

## [6.8.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.7.8...v6.8.0) (2026-02-24)


### Features

* apply anti-detection to ALL scrapers via base class ([#32](https://github.com/sergienko4/israeli-bank-scrapers/issues/32)) ([d8e9e5e](https://github.com/sergienko4/israeli-bank-scrapers/commit/d8e9e5e2f04e9cb22c9980e76fbaeab88df2317e))

## [6.7.8](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.7.7...v6.7.8) (2026-02-24)


### Bug Fixes

* ratchet coverage thresholds to prevent regression ([#29](https://github.com/sergienko4/israeli-bank-scrapers/issues/29)) ([ed824c8](https://github.com/sergienko4/israeli-bank-scrapers/commit/ed824c837e3d780921e242dd7ab2c35f9132e840))

## [6.7.7](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.7.6...v6.7.7) (2026-02-24)


### Bug Fixes

* **ci:** use PAT for release-please to trigger CI on PRs ([#22](https://github.com/sergienko4/israeli-bank-scrapers/issues/22)) ([664c323](https://github.com/sergienko4/israeli-bank-scrapers/commit/664c32367531607c4bf17367fe57b471de2d4157))


### Documentation

* update documentation to match current CI/CD setup ([#23](https://github.com/sergienko4/israeli-bank-scrapers/issues/23)) ([e248f5f](https://github.com/sergienko4/israeli-bank-scrapers/commit/e248f5f0c0cf903a623780469ace58aa21b7659c))

## [6.7.6](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.7.5...v6.7.6) (2026-02-24)


### Code Refactoring

* **ci:** improve workflow quality from review ([#19](https://github.com/sergienko4/israeli-bank-scrapers/issues/19)) ([8084b1c](https://github.com/sergienko4/israeli-bank-scrapers/commit/8084b1c054e213b2b6fa3e28b6a60123f97a178f))

## [6.7.5](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.7.4...v6.7.5) (2026-02-24)


### Bug Fixes

* **ci:** install npm 11+ for Trusted Publishing OIDC support ([0a22fc1](https://github.com/sergienko4/israeli-bank-scrapers/commit/0a22fc1f7509a08055a0bb36f5280a2ac5a2a653))
* update Node to 22.14.0 for npm Trusted Publishing support ([37625ba](https://github.com/sergienko4/israeli-bank-scrapers/commit/37625ba2ea040259d61a7d85fb4abc7b8c1534b6))

## [6.7.4](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.7.3...v6.7.4) (2026-02-24)


### Bug Fixes

* **ci:** add NPM_TOKEN for CI publishing ([dc3552f](https://github.com/sergienko4/israeli-bank-scrapers/commit/dc3552f36193ab01962e052b542f4547e470721a))
* **ci:** trigger publish on GitHub Release (not tag push) ([ab00b4b](https://github.com/sergienko4/israeli-bank-scrapers/commit/ab00b4b9d6acd8982f9ed7ede36c2bdde78e6aae))

## [6.7.3](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.7.2...v6.7.3) (2026-02-24)


### Code Refactoring

* improve code quality from review ([1687e57](https://github.com/sergienko4/israeli-bank-scrapers/commit/1687e57f71156d85f836957e6ebf3984892d7e30))

## [6.7.2](https://github.com/sergienko4/israeli-bank-scrapers/compare/v6.7.1...v6.7.2) (2026-02-24)


### Bug Fixes

* bypass Amex/Isracard WAF with anti-detection headers ([1cc4875](https://github.com/sergienko4/israeli-bank-scrapers/commit/1cc4875f5a54b224d11ddf6bc8c61da619380606))
