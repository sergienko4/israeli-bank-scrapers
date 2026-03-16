# Changelog

## [8.2.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v8.1.0...v8.2.0) (2026-03-16)


### Features

* add SonarCloud static analysis workflow ([#160](https://github.com/sergienko4/israeli-bank-scrapers/issues/160)) ([3bf3c43](https://github.com/sergienko4/israeli-bank-scrapers/commit/3bf3c43e69af745e8d86d54c5ebb6eeec31d44db))


### Bug Fixes

* replace Max CSS ID selectors with visible Hebrew text ([#163](https://github.com/sergienko4/israeli-bank-scrapers/issues/163)) ([ad2e14a](https://github.com/sergienko4/israeli-bank-scrapers/commit/ad2e14a786fc71d874cc954ee02de404bca36e71))

## [8.1.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v8.0.6...v8.1.0) (2026-03-14)


### Features

* add integration test framework with 18 tests for 6 scrapers ([#158](https://github.com/sergienko4/israeli-bank-scrapers/issues/158)) ([a6a4dfe](https://github.com/sergienko4/israeli-bank-scrapers/commit/a6a4dfe451cf4e8b894568c8d4affbaedc728b26))

## [8.0.6](https://github.com/sergienko4/israeli-bank-scrapers/compare/v8.0.5...v8.0.6) (2026-03-14)


### Bug Fixes

* harden CI/CD — timeouts, reliability, consolidate 10 jobs into 2 ([#154](https://github.com/sergienko4/israeli-bank-scrapers/issues/154)) ([cb6d573](https://github.com/sergienko4/israeli-bank-scrapers/commit/cb6d5739cb8315c2c0194a12cb5880ec0e15f3d8))

## [8.0.5](https://github.com/sergienko4/israeli-bank-scrapers/compare/v8.0.4...v8.0.5) (2026-03-13)


### Bug Fixes

* eliminate silent errors and improve log readability ([#148](https://github.com/sergienko4/israeli-bank-scrapers/issues/148)) ([b1581cb](https://github.com/sergienko4/israeli-bank-scrapers/commit/b1581cbb14bff93ce0ef2a7b4068e1950c5cbeb4))
* handle Max tree-version homepage login flow ([#150](https://github.com/sergienko4/israeli-bank-scrapers/issues/150)) ([aaac1cb](https://github.com/sergienko4/israeli-bank-scrapers/commit/aaac1cb27ca9ad5c8d180b96f676dd3c0c879534))
* move Node 24 env var to top-level in release-please workflow ([#147](https://github.com/sergienko4/israeli-bank-scrapers/issues/147)) ([a091831](https://github.com/sergienko4/israeli-bank-scrapers/commit/a09183170f2ef1ce7805967b251a35b55a013792))
* opt into Node.js 24 for all CI workflows ([#145](https://github.com/sergienko4/israeli-bank-scrapers/issues/145)) ([b96a0ad](https://github.com/sergienko4/israeli-bank-scrapers/commit/b96a0ad632be485241b567c5dbd91e0db2f73bf1))
* switch to allow-licenses allowlist + fix flatted vulnerability ([#151](https://github.com/sergienko4/israeli-bank-scrapers/issues/151)) ([fbceb9d](https://github.com/sergienko4/israeli-bank-scrapers/commit/fbceb9dba92e180738d93a887bc1795b5490ef61))

## [8.0.4](https://github.com/sergienko4/israeli-bank-scrapers/compare/v8.0.3...v8.0.4) (2026-03-12)


### Bug Fixes

* add bank name to all scraper log lines for CI readability ([#143](https://github.com/sergienko4/israeli-bank-scrapers/issues/143)) ([2f4fb87](https://github.com/sergienko4/israeli-bank-scrapers/commit/2f4fb87a8374fd6f1d207c5f64efb31c341a0d46))
* opt into Node.js 24 for release-please action ([#140](https://github.com/sergienko4/israeli-bank-scrapers/issues/140)) ([f03e3a5](https://github.com/sergienko4/israeli-bank-scrapers/commit/f03e3a5ae4ac7ec76cba3fd1153b6459632185b0))
* switch VisaCal API calls from native fetch to browser-context fetch ([#144](https://github.com/sergienko4/israeli-bank-scrapers/issues/144)) ([a18f40a](https://github.com/sergienko4/israeli-bank-scrapers/commit/a18f40ac79aa3148c76fdf60aa248ff26ba29c82))

## [8.0.3](https://github.com/sergienko4/israeli-bank-scrapers/compare/v8.0.2...v8.0.3) (2026-03-12)


### Bug Fixes

* add OTP confirm flow for Beinleumi group banks ([#136](https://github.com/sergienko4/israeli-bank-scrapers/issues/136)) ([a01866e](https://github.com/sergienko4/israeli-bank-scrapers/commit/a01866e913a47ed96e2a461f1a2b2c20df4a7b41))

## [8.0.2](https://github.com/sergienko4/israeli-bank-scrapers/compare/v8.0.1...v8.0.2) (2026-03-11)


### Bug Fixes

* opt into Node.js 24 for GitHub Pages actions ([#132](https://github.com/sergienko4/israeli-bank-scrapers/issues/132)) ([d222c8a](https://github.com/sergienko4/israeli-bank-scrapers/commit/d222c8aac35dda4240e91538557e5bb7ca169f74))
* restrict GITHUB_TOKEN permissions per OSSF Scorecard ([#134](https://github.com/sergienko4/israeli-bank-scrapers/issues/134)) ([35b9f0b](https://github.com/sergienko4/israeli-bank-scrapers/commit/35b9f0bbbc70b8c9c632dfa7aa71de55199f3620))

## [8.0.1](https://github.com/sergienko4/israeli-bank-scrapers/compare/v8.0.0...v8.0.1) (2026-03-11)


### Bug Fixes

* add CodeQL security analysis workflow ([#128](https://github.com/sergienko4/israeli-bank-scrapers/issues/128)) ([66e59e8](https://github.com/sergienko4/israeli-bank-scrapers/commit/66e59e84b702a57f7687204466ee00e8a5c3230e))
* move CodeQL to standalone workflow + skip hook for non-code changes ([#130](https://github.com/sergienko4/israeli-bank-scrapers/issues/130)) ([84c6415](https://github.com/sergienko4/israeli-bank-scrapers/commit/84c6415102c09a8fabc0a3bfc02328b3d3ce356e))
* rewrite README with balanced layout, doctoc TOC, and all-contributors ([#127](https://github.com/sergienko4/israeli-bank-scrapers/issues/127)) ([56be12c](https://github.com/sergienko4/israeli-bank-scrapers/commit/56be12ccc6dcb1546b7a35bb5281653a3814653e))
* skip Camoufox fetch when cached, avoid GitHub API rate limits ([#131](https://github.com/sergienko4/israeli-bank-scrapers/issues/131)) ([ed1745d](https://github.com/sergienko4/israeli-bank-scrapers/commit/ed1745db9e29791d263a6f3cbe87cc125280d440))

## [8.0.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.10.0...v8.0.0) (2026-03-10)


### ⚠ BREAKING CHANGES

* All interfaces renamed with I-prefix (e.g., Transaction → ITransaction, ScraperScrapingResult → IScraperScrapingResult). Public API callback types use LifecyclePromise instead of void. fetchGetWithinPage/fetchPostWithinPage return Nullable<TResult> instead of TResult.

### Features

* strict ESLint config with JSDoc, I-prefix, architectural bans ([#119](https://github.com/sergienko4/israeli-bank-scrapers/issues/119)) ([becfecf](https://github.com/sergienko4/israeli-bank-scrapers/commit/becfecfead80edf1cc9fb8b5f27737843e8691b3))
* textContent selector + form-anchor + Max single-flow refactor ([#124](https://github.com/sergienko4/israeli-bank-scrapers/issues/124)) ([f8bbfff](https://github.com/sergienko4/israeli-bank-scrapers/commit/f8bbfff27de362e588f82c95dc39dfa7d8419902))


### Bug Fixes

* add backward-compatible type aliases for v7.x consumers ([#121](https://github.com/sergienko4/israeli-bank-scrapers/issues/121)) ([842a8a4](https://github.com/sergienko4/israeli-bank-scrapers/commit/842a8a438bb544563d120f71a31535769cb354b9))
* add diagnostic logging to Max postAction + increase timeout to 60s ([#125](https://github.com/sergienko4/israeli-bank-scrapers/issues/125)) ([442efd6](https://github.com/sergienko4/israeli-bank-scrapers/commit/442efd6778b6ebfcd174651612db2188e2587359))

## [7.10.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.9.0...v7.10.0) (2026-03-08)


### Features

* add login chain logging with PII-safe result summary ([#110](https://github.com/sergienko4/israeli-bank-scrapers/issues/110)) ([2ef55ba](https://github.com/sergienko4/israeli-bank-scrapers/commit/2ef55ba34c106c67a017338a7d10beb230c4fab4))
* enhance SelectorResolver with label-text-first field resolution ([#113](https://github.com/sergienko4/israeli-bank-scrapers/issues/113)) ([7ad2ccd](https://github.com/sergienko4/israeli-bank-scrapers/commit/7ad2ccd2010ec1e5b133a557dc3f34dc73588877))
* remove all CSS selectors from login fields — visible text first ([#115](https://github.com/sergienko4/israeli-bank-scrapers/issues/115)) ([476cf8e](https://github.com/sergienko4/israeli-bank-scrapers/commit/476cf8e87f8a2cee58dfffab0832b932a7fe56c3))


### Bug Fixes

* pre-commit hook runs full lint (same as CI) ([#112](https://github.com/sergienko4/israeli-bank-scrapers/issues/112)) ([4397af7](https://github.com/sergienko4/israeli-bank-scrapers/commit/4397af7e5feb8f3d74b8cc99a64a61877fff8d9a))

## [7.9.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.8.1...v7.9.0) (2026-03-08)


### Features

* replace playwright-extra+stealth with @hieutran094/camoufox-js ([#107](https://github.com/sergienko4/israeli-bank-scrapers/issues/107)) ([f5a340c](https://github.com/sergienko4/israeli-bank-scrapers/commit/f5a340cce03eebc79a9acd70698b03e82dbbf51a))

## [7.8.1](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.8.0...v7.8.1) (2026-03-04)


### Bug Fixes

* handle Max second-login ID verification step (Flow B) ([#102](https://github.com/sergienko4/israeli-bank-scrapers/issues/102)) ([0995ff3](https://github.com/sergienko4/israeli-bank-scrapers/commit/0995ff315dcd13fb692885f29c4c13cf8e82684d))

## [7.8.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.7.0...v7.8.0) (2026-03-03)


### Features

* ESLint strict + SelectorResolver dashboard + VisaCal & Beinleumi fixes ([#96](https://github.com/sergienko4/israeli-bank-scrapers/issues/96)) ([e367712](https://github.com/sergienko4/israeli-bank-scrapers/commit/e3677124f6fbd678f709671fdf9feac64bbe1fda))

## [7.7.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.6.0...v7.7.0) (2026-03-03)


### Features

* ESLint 10 + stealth plugin + VisaCal login fix + pino logger ([#92](https://github.com/sergienko4/israeli-bank-scrapers/issues/92)) ([5c7afc6](https://github.com/sergienko4/israeli-bank-scrapers/commit/5c7afc633c4d9ee7cc4dd647f115c258bbcb4d74))

## [7.6.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.5.1...v7.6.0) (2026-03-02)


### Features

* **ci:** expand pre-commit to 8-gate validation matching CI pipeline ([#82](https://github.com/sergienko4/israeli-bank-scrapers/issues/82)) ([c715912](https://github.com/sergienko4/israeli-bank-scrapers/commit/c7159120f31fe731717013e26d637d064e7df13a))


### Bug Fixes

* **esm:** change OneZero moment import to bare specifier ([#81](https://github.com/sergienko4/israeli-bank-scrapers/issues/81)) ([a44b219](https://github.com/sergienko4/israeli-bank-scrapers/commit/a44b219c001862fb50467691ba62f81c67894cf7))

## [7.5.1](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.5.0...v7.5.1) (2026-03-02)


### Bug Fixes

* **ci:** replace Babel with tsup in release-please publish workflow ([#79](https://github.com/sergienko4/israeli-bank-scrapers/issues/79)) ([41b82d8](https://github.com/sergienko4/israeli-bank-scrapers/commit/41b82d8dee93d574fb3adc74ea3441e984016943))

## [7.5.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.4.0...v7.5.0) (2026-03-02)


### Features

* **toolchain:** zero-compromise ESLint + strict types + tsup ESM build ([#76](https://github.com/sergienko4/israeli-bank-scrapers/issues/76)) ([aaa6751](https://github.com/sergienko4/israeli-bank-scrapers/commit/aaa6751dae2dc8b4d1fc56895d01a84ee8b05783))

## [7.4.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.3.1...v7.4.0) (2026-03-01)


### Features

* **eslint+naming:** PascalCase file/folder convention, strict naming rules, generic login fix + Max domain fix ([#74](https://github.com/sergienko4/israeli-bank-scrapers/issues/74)) ([aecce66](https://github.com/sergienko4/israeli-bank-scrapers/commit/aecce667f5257212f0d37943b025f13a969bb5e3))

## [7.3.1](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.3.0...v7.3.1) (2026-02-28)


### Bug Fixes

* **discount:** return success with 0 txns when API has no records in range ([#72](https://github.com/sergienko4/israeli-bank-scrapers/issues/72)) ([20579fd](https://github.com/sergienko4/israeli-bank-scrapers/commit/20579fd9c564d7a003fd42adb9a9b92df45d8b1d))

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
