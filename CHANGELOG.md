# Changelog

## [8.0.0](https://github.com/sergienko4/israeli-bank-scrapers/compare/v7.8.0...v8.0.0) (2026-03-03)


### ⚠ BREAKING CHANGES

* browser/browserContext/preparePage options now expect Playwright types. getPuppeteerConfig() removed.
* `CompanyTypes.hapoalimBeOnline` and `CompanyTypes.leumiCard` removed, use `CompanyTypes.hapoalim` and `CompanyTypes.max`
* the library is set to use Node 18 and above, deprecating support for Node 16. Also, some libraries were replaced that might be in use by your project with previous versions.
* node v14 is not supported anymore
* **Isracard:** When fullPaymentDate is provided, it will be used instead of the default processed date
* changing default time-zone to Asia/Jerusalem shouldn't affect people scrapping usually from Israel but might affect people using he scrappers aboard.

### Features

* add balance to hapoalim and mizrahi ([#576](https://github.com/sergienko4/israeli-bank-scrapers/issues/576)) ([a99aac0](https://github.com/sergienko4/israeli-bank-scrapers/commit/a99aac0988b20c7fe1f5d8056a907db238914ad6))
* add bank pagi scraper ([#880](https://github.com/sergienko4/israeli-bank-scrapers/issues/880)) ([cbbf9b7](https://github.com/sergienko4/israeli-bank-scrapers/commit/cbbf9b7bb9915f51eee680042af0bcc19ad8c8ac))
* add bank yahav scrapper ([#631](https://github.com/sergienko4/israeli-bank-scrapers/issues/631)) ([3fcfb7a](https://github.com/sergienko4/israeli-bank-scrapers/commit/3fcfb7a5cd619a33a7022cc2708a45c084c7f529))
* add charged currency support for max ([#806](https://github.com/sergienko4/israeli-bank-scrapers/issues/806)) ([25a4fb1](https://github.com/sergienko4/israeli-bank-scrapers/commit/25a4fb1bb62ba1f03eec83e93871241b24002607))
* add enableTransactionsFilterByDate option ([#728](https://github.com/sergienko4/israeli-bank-scrapers/issues/728)) ([c44b617](https://github.com/sergienko4/israeli-bank-scrapers/commit/c44b617fb7d2200159429496f360c88a70a6ae90))
* add memo to visa cal ([#778](https://github.com/sergienko4/israeli-bank-scrapers/issues/778)) ([5997a86](https://github.com/sergienko4/israeli-bank-scrapers/commit/5997a8675f831c0a72339154a1813f5254c53597))
* add option to include raw transaction data ([#1031](https://github.com/sergienko4/israeli-bank-scrapers/issues/1031)) ([4d9ab7d](https://github.com/sergienko4/israeli-bank-scrapers/commit/4d9ab7dca4680f455997552af19a20d89d44cc8b))
* add option to include raw transaction data for debugging in scraper options ([821de80](https://github.com/sergienko4/israeli-bank-scrapers/commit/821de802cc3782f2b52684b251549ff3f5cab723))
* add option to scrape future months for isracard and max ([#620](https://github.com/sergienko4/israeli-bank-scrapers/issues/620)) ([0cc4461](https://github.com/sergienko4/israeli-bank-scrapers/commit/0cc4461496ed65a7003846fb56354de3b48465a6))
* add option to set the default timeout on puppeteer's `page.setDefaultTimeout()` ([#711](https://github.com/sergienko4/israeli-bank-scrapers/issues/711)) ([30061dd](https://github.com/sergienko4/israeli-bank-scrapers/commit/30061dda9641d00f97a31b708ff46b4fe759b253))
* add raw transaction data in transaction conversion across scrapers ([c2e6382](https://github.com/sergienko4/israeli-bank-scrapers/commit/c2e6382561049b7f9af3347b2c839bf878905704))
* add scraper for Behatsdaa ([#811](https://github.com/sergienko4/israeli-bank-scrapers/issues/811)) ([61c5350](https://github.com/sergienko4/israeli-bank-scrapers/commit/61c53500ef289a06a9536bd6d7c4ff9f54b32f2a))
* add support for 'חלוקת חיוב חודשי' transaction type in Max scraper ([#1033](https://github.com/sergienko4/israeli-bank-scrapers/issues/1033)) ([16e6044](https://github.com/sergienko4/israeli-bank-scrapers/commit/16e604448014425c7f88634e89c161edf4b2a5bc))
* add timeout support ([#733](https://github.com/sergienko4/israeli-bank-scrapers/issues/733)) ([4dc3e69](https://github.com/sergienko4/israeli-bank-scrapers/commit/4dc3e692be9540c19e27e46e3ff09ecb9963acfd))
* add transaction id and category in the new cal site ([#780](https://github.com/sergienko4/israeli-bank-scrapers/issues/780)) ([580cc03](https://github.com/sergienko4/israeli-bank-scrapers/commit/580cc03173268ca86620df26cbb8a05401c88f52))
* add TypeDoc auto-docs published to GitHub Pages ([#68](https://github.com/sergienko4/israeli-bank-scrapers/issues/68)) ([173ddfc](https://github.com/sergienko4/israeli-bank-scrapers/commit/173ddfcf6d24be8c8d65f1d6300d2bbf6c15cb43))
* Added account balance to discount ([#587](https://github.com/sergienko4/israeli-bank-scrapers/issues/587)) ([df01263](https://github.com/sergienko4/israeli-bank-scrapers/commit/df01263c8f57a2597588590fea701d93d9c876cc))
* adding mercantile bank scraper ([#838](https://github.com/sergienko4/israeli-bank-scrapers/issues/838)) ([15bcd26](https://github.com/sergienko4/israeli-bank-scrapers/commit/15bcd2645e33c6a44713c04e26a81e193b07d389))
* allow to reuse a browser by passing a `browserContext` ([#884](https://github.com/sergienko4/israeli-bank-scrapers/issues/884)) ([fdc55a5](https://github.com/sergienko4/israeli-bank-scrapers/commit/fdc55a51e43ad567cdfb83cbc8a8abcad3bf78fb))
* apply anti-detection to ALL scrapers via base class ([#32](https://github.com/sergienko4/israeli-bank-scrapers/issues/32)) ([d8e9e5e](https://github.com/sergienko4/israeli-bank-scrapers/commit/d8e9e5e2f04e9cb22c9980e76fbaeab88df2317e))
* automatic deployment ([9e56353](https://github.com/sergienko4/israeli-bank-scrapers/commit/9e5635347773b37bfbe9c8cfc812ff0907e00bf3))
* beinleumi scrapper - balance support ([#605](https://github.com/sergienko4/israeli-bank-scrapers/issues/605)) ([492a611](https://github.com/sergienko4/israeli-bank-scrapers/commit/492a61117fab467966be791176cb345a13ef7b96))
* **beyahad-bishvilha:** support new scraper for the histadrut site beyahad bishvilha ([#642](https://github.com/sergienko4/israeli-bank-scrapers/issues/642)) ([72f5e13](https://github.com/sergienko4/israeli-bank-scrapers/commit/72f5e13039bfe93b0b5d9b2f60736208f139bfd5))
* **cal:** fetch pending transaction ([#794](https://github.com/sergienko4/israeli-bank-scrapers/issues/794)) ([70e2a62](https://github.com/sergienko4/israeli-bank-scrapers/commit/70e2a628473e4b387a402a39d2c85c8ed005e711))
* **cal:** scrape future debits if available ([#656](https://github.com/sergienko4/israeli-bank-scrapers/issues/656)) ([988f1b1](https://github.com/sergienko4/israeli-bank-scrapers/commit/988f1b13fe3ac11ff4b178b1769f6e04aa6b65d6))
* **ci:** expand pre-commit to 8-gate validation matching CI pipeline ([#82](https://github.com/sergienko4/israeli-bank-scrapers/issues/82)) ([c715912](https://github.com/sergienko4/israeli-bank-scrapers/commit/c7159120f31fe731717013e26d637d064e7df13a))
* **e2e:** add Beinleumi OTP-screen CI test ([#67](https://github.com/sergienko4/israeli-bank-scrapers/issues/67)) ([ba67f00](https://github.com/sergienko4/israeli-bank-scrapers/commit/ba67f0075e2db9a7128f72a39096bedcdeb6604e))
* ESLint 10 + stealth plugin + VisaCal login fix + pino logger ([#92](https://github.com/sergienko4/israeli-bank-scrapers/issues/92)) ([5c7afc6](https://github.com/sergienko4/israeli-bank-scrapers/commit/5c7afc633c4d9ee7cc4dd647f115c258bbcb4d74))
* ESLint strict + SelectorResolver dashboard + VisaCal & Beinleumi fixes ([#96](https://github.com/sergienko4/israeli-bank-scrapers/issues/96)) ([e367712](https://github.com/sergienko4/israeli-bank-scrapers/commit/e3677124f6fbd678f709671fdf9feac64bbe1fda))
* **eslint+naming:** PascalCase file/folder convention, strict naming rules, generic login fix + Max domain fix ([#74](https://github.com/sergienko4/israeli-bank-scrapers/issues/74)) ([aecce66](https://github.com/sergienko4/israeli-bank-scrapers/commit/aecce667f5257212f0d37943b025f13a969bb5e3))
* get extra data (for now - category) from isracard ([#741](https://github.com/sergienko4/israeli-bank-scrapers/issues/741)) ([3a00d71](https://github.com/sergienko4/israeli-bank-scrapers/commit/3a00d71e6cdee2cf8f9c538b6f2ef08c30c9b918))
* increase waiting time for the update email page in mizrahi ([#718](https://github.com/sergienko4/israeli-bank-scrapers/issues/718)) ([9eac2f2](https://github.com/sergienko4/israeli-bank-scrapers/commit/9eac2f2de598d3a9b18b9191c90b75525b042d07))
* integrate puppeteer-extra-plugin-stealth for enhanced anti-detection ([#47](https://github.com/sergienko4/israeli-bank-scrapers/issues/47)) ([fadb0dc](https://github.com/sergienko4/israeli-bank-scrapers/commit/fadb0dc7362aaf3a9c85955a82d0c813e2ec9425))
* Introducing 2FA scrapers infrastructure + OneZero experimental scraper ([#760](https://github.com/sergienko4/israeli-bank-scrapers/issues/760)) ([2da370e](https://github.com/sergienko4/israeli-bank-scrapers/commit/2da370e080f1b54e418601084df98688de9e1d14))
* **max:** add category support ([#636](https://github.com/sergienko4/israeli-bank-scrapers/issues/636)) ([4b8b4bd](https://github.com/sergienko4/israeli-bank-scrapers/commit/4b8b4bdb35fabcffda57b9eeb321b8cc610fa186))
* migrate from Puppeteer to Playwright ([#54](https://github.com/sergienko4/israeli-bank-scrapers/issues/54)) ([4974e0f](https://github.com/sergienko4/israeli-bank-scrapers/commit/4974e0f1e49fd4545ac01249df0f23ef2dafd93f))
* mizrahi soft matching on links ([#748](https://github.com/sergienko4/israeli-bank-scrapers/issues/748)) ([da31883](https://github.com/sergienko4/israeli-bank-scrapers/commit/da31883022cee727252086718d11468f82ea83eb))
* mizrahi support both 'OnlinePilot' and 'Online' API ([#754](https://github.com/sergienko4/israeli-bank-scrapers/issues/754)) ([82d6277](https://github.com/sergienko4/israeli-bank-scrapers/commit/82d6277d348180e5d61ad52f19fff23b0834fc5d))
* **mizrahi-scraper:** add update email page support ([#666](https://github.com/sergienko4/israeli-bank-scrapers/issues/666)) ([347d9b5](https://github.com/sergienko4/israeli-bank-scrapers/commit/347d9b58974a71c256313552389914afc1bf5d8e))
* **mizrahi:** add memo to transactions ([#996](https://github.com/sergienko4/israeli-bank-scrapers/issues/996)) ([ac0d732](https://github.com/sergienko4/israeli-bank-scrapers/commit/ac0d7322449279bc1e1cd2fbe34cd16182bab83c))
* **mizrahi:** support multiple accounts ([#623](https://github.com/sergienko4/israeli-bank-scrapers/issues/623)) ([6301efd](https://github.com/sergienko4/israeli-bank-scrapers/commit/6301efd1c1178378774a0c65fff421522ec7714d)), closes [#622](https://github.com/sergienko4/israeli-bank-scrapers/issues/622)
* multiple accounts on beinleumi base ([#842](https://github.com/sergienko4/israeli-bank-scrapers/issues/842)) ([3a605dc](https://github.com/sergienko4/israeli-bank-scrapers/commit/3a605dc76f9e8b1bd169f841d2c99b94df58577a))
* **otsar hayal:** support long date format in transactions ([#638](https://github.com/sergienko4/israeli-bank-scrapers/issues/638)) ([ea76e6b](https://github.com/sergienko4/israeli-bank-scrapers/commit/ea76e6bbb6708ea1c5e5d636398ed33205f0193e))
* otsar inherit beinleumi bank ([#885](https://github.com/sergienko4/israeli-bank-scrapers/issues/885)) ([62a7919](https://github.com/sergienko4/israeli-bank-scrapers/commit/62a79198037c7ffe788ca58406715485d5414fdb))
* **raw-transaction:** cleaner raw payload with additional information ([#1046](https://github.com/sergienko4/israeli-bank-scrapers/issues/1046)) ([a7b5144](https://github.com/sergienko4/israeli-bank-scrapers/commit/a7b5144aa99c821594945fefbdc22f9e2e7db9c4))
* remove empty keys from raw transaction data ([79ceceb](https://github.com/sergienko4/israeli-bank-scrapers/commit/79ceceb2581662d5b0f65c49526b9d8c55be1efd))
* resilient login field detection — 4-round selector fallback + bank registry ([#63](https://github.com/sergienko4/israeli-bank-scrapers/issues/63)) ([d67a59f](https://github.com/sergienko4/israeli-bank-scrapers/commit/d67a59f0b44af42c10f610778049ead24e9c6b07))
* rewrite vis-cal scraper to use puppeteer ([#609](https://github.com/sergienko4/israeli-bank-scrapers/issues/609)) ([61a70ca](https://github.com/sergienko4/israeli-bank-scrapers/commit/61a70ca9888521716cc34ada0f69d1968aaf8537))
* **scraper:** add navigation retry count option and improve error handling during navigation ([45c1470](https://github.com/sergienko4/israeli-bank-scrapers/commit/45c14701ca69e1ebe3ee2548de679011a3043486))
* **scraper:** safe cleanup ([#968](https://github.com/sergienko4/israeli-bank-scrapers/issues/968)) ([634b6f6](https://github.com/sergienko4/israeli-bank-scrapers/commit/634b6f6635f506c4f333dffdbef156050cab5f95))
* set leumi minimum starting date (3y) ([#724](https://github.com/sergienko4/israeli-bank-scrapers/issues/724)) ([ad809bf](https://github.com/sergienko4/israeli-bank-scrapers/commit/ad809bf541617b0acc8c763ec106a79c9b559c6f))
* support "futureMonthsToScrape" option in cal ([#777](https://github.com/sergienko4/israeli-bank-scrapers/issues/777)) ([7afe7ea](https://github.com/sergienko4/israeli-bank-scrapers/commit/7afe7ea071c60bf662e11f1226929ad033e07802))
* support additionalInformation in rawTransaction ([13c0327](https://github.com/sergienko4/israeli-bank-scrapers/commit/13c0327b1d8b26ef485c5f57ef1f244833f4a7a2))
* support automatic deployment ([c1c1f20](https://github.com/sergienko4/israeli-bank-scrapers/commit/c1c1f20359d6999a3b7e27ca1df3b4114407bd2c))
* Support Visa Cal change password flow ([#845](https://github.com/sergienko4/israeli-bank-scrapers/issues/845)) ([71262d4](https://github.com/sergienko4/israeli-bank-scrapers/commit/71262d45aa5576e9a8e96a07ab02d5841cdc6080))
* **toolchain:** zero-compromise ESLint + strict types + tsup ESM build ([#76](https://github.com/sergienko4/israeli-bank-scrapers/issues/76)) ([aaa6751](https://github.com/sergienko4/israeli-bank-scrapers/commit/aaa6751dae2dc8b4d1fc56895d01a84ee8b05783))
* upgrade project dependencies ([#862](https://github.com/sergienko4/israeli-bank-scrapers/issues/862)) ([de0e614](https://github.com/sergienko4/israeli-bank-scrapers/commit/de0e6144ceeb1e4421a96dda2744a0ff2f6ee356))
* upgrade puppeteer to v6 ([#692](https://github.com/sergienko4/israeli-bank-scrapers/issues/692)) ([dae6eee](https://github.com/sergienko4/israeli-bank-scrapers/commit/dae6eee1bb2fd11f8e92ebecb888b9dfc2613f68))
* use timezone Asia/Jerusalem by default ([#715](https://github.com/sergienko4/israeli-bank-scrapers/issues/715)) ([b369559](https://github.com/sergienko4/israeli-bank-scrapers/commit/b369559c92c001cca9ce14c7ab75fde5629a895c))
* use waitUntil to retry getting init data ([#775](https://github.com/sergienko4/israeli-bank-scrapers/issues/775)) ([b0d9472](https://github.com/sergienko4/israeli-bank-scrapers/commit/b0d9472e8e2c7a9ccd36ab9a22b9792deb81335e))
* **visa-cal:** integrate frame (misgeret) data into fetchData ([#1020](https://github.com/sergienko4/israeli-bank-scrapers/issues/1020)) ([c549659](https://github.com/sergienko4/israeli-bank-scrapers/commit/c549659470ac86e77219a150c0bd2d3c6469d3dc))
* **visa-cal:** Support additional info to get categories  ([#751](https://github.com/sergienko4/israeli-bank-scrapers/issues/751)) ([98499fa](https://github.com/sergienko4/israeli-bank-scrapers/commit/98499fa15ce499817cb60729e48c6aad111d4426))
* **visa:** support empty pages ([#635](https://github.com/sergienko4/israeli-bank-scrapers/issues/635)) ([3736347](https://github.com/sergienko4/israeli-bank-scrapers/commit/37363479d4f0b0a96778b812f6b227d3febe2596))


### Bug Fixes

* add 403 retry with 15s delay for WAF-blocked datacenter IPs ([#57](https://github.com/sergienko4/israeli-bank-scrapers/issues/57)) ([98eadd7](https://github.com/sergienko4/israeli-bank-scrapers/commit/98eadd70d318a66574cb4a3328d10a4e1ee66ba7))
* add debug and try to resolve visa-cal navigation timeout issue ([#616](https://github.com/sergienko4/israeli-bank-scrapers/issues/616)) ([67c2916](https://github.com/sergienko4/israeli-bank-scrapers/commit/67c29169717342326fc8df6934cb070046cf6d7a))
* add max unknown transaction types ([#695](https://github.com/sergienko4/israeli-bank-scrapers/issues/695)) ([be08917](https://github.com/sergienko4/israeli-bank-scrapers/commit/be08917acfd8cda2bbd04b5d80237d668579fb43))
* add missing transaction type for max ([#805](https://github.com/sergienko4/israeli-bank-scrapers/issues/805)) ([1a8c100](https://github.com/sergienko4/israeli-bank-scrapers/commit/1a8c100758f76cf9c8b6d2c96dbcd86c28a7825e))
* add page ready state check to prevent execution context errors ([#955](https://github.com/sergienko4/israeli-bank-scrapers/issues/955)) ([4824b20](https://github.com/sergienko4/israeli-bank-scrapers/commit/4824b20b9b918abe4f2661d375267fc714712fac))
* **bein-leumi:** scrape balance first ([#611](https://github.com/sergienko4/israeli-bank-scrapers/issues/611)) ([a65faf2](https://github.com/sergienko4/israeli-bank-scrapers/commit/a65faf29a2fe206d4550f652255b46c57404fb04))
* **beinleumi:** account with no balance (inactive) ([#893](https://github.com/sergienko4/israeli-bank-scrapers/issues/893)) ([26837de](https://github.com/sergienko4/israeli-bank-scrapers/commit/26837defff377f336b246117f715a20923e8c12a))
* **beinleumi:** add waits on balance and account elements ([#949](https://github.com/sergienko4/israeli-bank-scrapers/issues/949)) ([5c65a90](https://github.com/sergienko4/israeli-bank-scrapers/commit/5c65a90d4211f9fb486dced1604fd94ffb4f45cb))
* **beinleumi:** added support for balance over 100K ([#853](https://github.com/sergienko4/israeli-bank-scrapers/issues/853)) ([128e245](https://github.com/sergienko4/israeli-bank-scrapers/commit/128e2451e8595692829ee20f15f070f12734f008))
* **beinleumi:** allow scraping older transactions ([#896](https://github.com/sergienko4/israeli-bank-scrapers/issues/896)) ([80fdf49](https://github.com/sergienko4/israeli-bank-scrapers/commit/80fdf4969688075d9f5be3a2e7982a098dfe7976))
* **beinleumi:** Graceful multi account support in new UI ([#946](https://github.com/sergienko4/israeli-bank-scrapers/issues/946)) ([66f3f8d](https://github.com/sergienko4/israeli-bank-scrapers/commit/66f3f8d5f76b765eb2477a61d5bc0445eebc3c5e))
* **beinleumi:** support both new and old UI ([#908](https://github.com/sergienko4/israeli-bank-scrapers/issues/908)) ([d402068](https://github.com/sergienko4/israeli-bank-scrapers/commit/d4020683aef6eff271ac4bc3bce27e249abec389))
* **beinleumi:** support new UI ([#903](https://github.com/sergienko4/israeli-bank-scrapers/issues/903)) ([94f9e1d](https://github.com/sergienko4/israeli-bank-scrapers/commit/94f9e1dd5169685bfe2bc8f84108a6f6d74769f5))
* **benleumi:** fix [#966](https://github.com/sergienko4/israeli-bank-scrapers/issues/966) timeout error for new UI ([#1003](https://github.com/sergienko4/israeli-bank-scrapers/issues/1003)) ([3bdfa72](https://github.com/sergienko4/israeli-bank-scrapers/commit/3bdfa727939350f4b55d80c6d72435a4205a0643))
* broken Isracard scraper due to request for detector-dom.min ([#683](https://github.com/sergienko4/israeli-bank-scrapers/issues/683)) ([f11bd1c](https://github.com/sergienko4/israeli-bank-scrapers/commit/f11bd1c6e088e9a96d1bf2d337f257047e6251b5))
* broken visa cal ([#661](https://github.com/sergienko4/israeli-bank-scrapers/issues/661)) ([e9ef52a](https://github.com/sergienko4/israeli-bank-scrapers/commit/e9ef52a2e3d0dc8ba299d4835b1811d03d2b63b8))
* **build:** re-add babel due to better commonjs exports ([e4a7ba6](https://github.com/sergienko4/israeli-bank-scrapers/commit/e4a7ba65ccf3c754019ef0342e115e0ca4d08ba1))
* **build:** re-add babel due to better commonjs exports ([#944](https://github.com/sergienko4/israeli-bank-scrapers/issues/944)) ([23aa81c](https://github.com/sergienko4/israeli-bank-scrapers/commit/23aa81c0cb76eddb487b71e6319990a7539a31a2))
* bypass Amex/Isracard WAF with anti-detection headers ([1cc4875](https://github.com/sergienko4/israeli-bank-scrapers/commit/1cc4875f5a54b224d11ddf6bc8c61da619380606))
* bypass Cloudflare WAF for Amex/Isracard with retry + manual stealth ([dd3a6a1](https://github.com/sergienko4/israeli-bank-scrapers/commit/dd3a6a18f50757517000f2341d4ea892e23bb752))
* bypass Cloudflare WAF for Amex/Isracard with retry + manual stealth ([#49](https://github.com/sergienko4/israeli-bank-scrapers/issues/49)) ([dd3a6a1](https://github.com/sergienko4/israeli-bank-scrapers/commit/dd3a6a18f50757517000f2341d4ea892e23bb752))
* cal site updated scraper is failing ([#767](https://github.com/sergienko4/israeli-bank-scrapers/issues/767)) ([12c31ac](https://github.com/sergienko4/israeli-bank-scrapers/commit/12c31ac2cc78c22b71b24168b4a08dfea2b5fc38))
* **cal:** authorization not being set ([#964](https://github.com/sergienko4/israeli-bank-scrapers/issues/964)) ([478c91d](https://github.com/sergienko4/israeli-bank-scrapers/commit/478c91da1f28289d0dfd0a3a06c9f3787fd52526))
* **cal:** better token check and improved login wait ([#941](https://github.com/sergienko4/israeli-bank-scrapers/issues/941)) ([d1402fa](https://github.com/sergienko4/israeli-bank-scrapers/commit/d1402fa63a85bd38d192f2ac4be6e33cdfc6f9a3))
* **cal:** correct sign for credit transactions ([#994](https://github.com/sergienko4/israeli-bank-scrapers/issues/994)) ([018d02f](https://github.com/sergienko4/israeli-bank-scrapers/commit/018d02fffd6a49faefc9c23767a3d59b786836da))
* **cal:** fix close button class name ([41307bc](https://github.com/sergienko4/israeli-bank-scrapers/commit/41307bc512198150ecd33a12f94af3914a4cee33))
* **cal:** fix close button class name ([#909](https://github.com/sergienko4/israeli-bank-scrapers/issues/909)) ([82d1690](https://github.com/sergienko4/israeli-bank-scrapers/commit/82d169058c5ecf77ffc515a56d7a456ea76ec77a))
* card monthly fee throws an error ([#709](https://github.com/sergienko4/israeli-bank-scrapers/issues/709)) ([8c059f3](https://github.com/sergienko4/israeli-bank-scrapers/commit/8c059f3f155ebc72c813188b8d0748f10f419107))
* changed discount scraper default start date ([#850](https://github.com/sergienko4/israeli-bank-scrapers/issues/850)) ([bc02d91](https://github.com/sergienko4/israeli-bank-scrapers/commit/bc02d91706fd953af73800132484ceed58a1a7fb))
* **ci:** add NPM_TOKEN for CI publishing ([dc3552f](https://github.com/sergienko4/israeli-bank-scrapers/commit/dc3552f36193ab01962e052b542f4547e470721a))
* **ci:** install npm 11+ for Trusted Publishing OIDC support ([0a22fc1](https://github.com/sergienko4/israeli-bank-scrapers/commit/0a22fc1f7509a08055a0bb36f5280a2ac5a2a653))
* **ci:** replace Babel with tsup in release-please publish workflow ([#79](https://github.com/sergienko4/israeli-bank-scrapers/issues/79)) ([41b82d8](https://github.com/sergienko4/israeli-bank-scrapers/commit/41b82d8dee93d574fb3adc74ea3441e984016943))
* **ci:** trigger publish on GitHub Release (not tag push) ([ab00b4b](https://github.com/sergienko4/israeli-bank-scrapers/commit/ab00b4b9d6acd8982f9ed7ede36c2bdde78e6aae))
* **ci:** use PAT for release-please to trigger CI on PRs ([#22](https://github.com/sergienko4/israeli-bank-scrapers/issues/22)) ([664c323](https://github.com/sergienko4/israeli-bank-scrapers/commit/664c32367531607c4bf17367fe57b471de2d4157))
* CodeQL incomplete-sanitization in max.ts + enable Discount in CI ([#52](https://github.com/sergienko4/israeli-bank-scrapers/issues/52)) ([dccf481](https://github.com/sergienko4/israeli-bank-scrapers/commit/dccf481df80b1569d4175fe6bcbf0abcd4d37b6c))
* compile issue with core library ([#735](https://github.com/sergienko4/israeli-bank-scrapers/issues/735)) ([7c97ab6](https://github.com/sergienko4/israeli-bank-scrapers/commit/7c97ab6e44fa5e9ae5c9a491da782b8a86897438))
* **deps:** bump ws from 7.5.3 to 7.5.10 ([#867](https://github.com/sergienko4/israeli-bank-scrapers/issues/867)) ([70f25f5](https://github.com/sergienko4/israeli-bank-scrapers/commit/70f25f5be495ee68832df706c46c402afd9cf8c2))
* **discount:** add additional success URL for login results ([#990](https://github.com/sergienko4/israeli-bank-scrapers/issues/990)) ([6b25fcd](https://github.com/sergienko4/israeli-bank-scrapers/commit/6b25fcdbd7217a634409123ce30039c6dcf01841))
* **discount:** return success with 0 txns when API has no records in range ([#72](https://github.com/sergienko4/israeli-bank-scrapers/issues/72)) ([20579fd](https://github.com/sergienko4/israeli-bank-scrapers/commit/20579fd9c564d7a003fd42adb9a9b92df45d8b1d))
* **discount:** scrape transactions for all user accounts ([#1012](https://github.com/sergienko4/israeli-bank-scrapers/issues/1012)) ([e86f6ab](https://github.com/sergienko4/israeli-bank-scrapers/commit/e86f6abc686c82d9bbc54d8fdc8f4ea5a0e666e7))
* **discount:** support new redirect  url ([#1025](https://github.com/sergienko4/israeli-bank-scrapers/issues/1025)) ([3be4eee](https://github.com/sergienko4/israeli-bank-scrapers/commit/3be4eee4bb147a86f6b8c65e47872e996b923d1e))
* **discount:** update discount login success url ([#647](https://github.com/sergienko4/israeli-bank-scrapers/issues/647)) ([bc645a8](https://github.com/sergienko4/israeli-bank-scrapers/commit/bc645a8a179095f768b5e1482dd288d6a5bd827b))
* **e2e:** replace broken Beinleumi MATAF test with Massad ([#65](https://github.com/sergienko4/israeli-bank-scrapers/issues/65)) ([947f8f3](https://github.com/sergienko4/israeli-bank-scrapers/commit/947f8f3ba7af17814853196d84a50d5740955dc8))
* enforce single quotes also in ESLint ([45a3315](https://github.com/sergienko4/israeli-bank-scrapers/commit/45a3315bfaa846b3f2572d982d8cae1860383666))
* **esm:** change OneZero moment import to bare specifier ([#81](https://github.com/sergienko4/israeli-bank-scrapers/issues/81)) ([a44b219](https://github.com/sergienko4/israeli-bank-scrapers/commit/a44b219c001862fb50467691ba62f81c67894cf7))
* fix bein leumi login ([#699](https://github.com/sergienko4/israeli-bank-scrapers/issues/699)) ([6be6d51](https://github.com/sergienko4/israeli-bank-scrapers/commit/6be6d51bc9f060390b5e19520cb84c1974036cf0))
* fixed CAL login frame name ([#865](https://github.com/sergienko4/israeli-bank-scrapers/issues/865)) ([fdfc158](https://github.com/sergienko4/israeli-bank-scrapers/commit/fdfc158b5452661170085239fdbcb77d2fccc122))
* Fixing otsar hayal scraper ([#585](https://github.com/sergienko4/israeli-bank-scrapers/issues/585)) ([b99cf11](https://github.com/sergienko4/israeli-bank-scrapers/commit/b99cf11bbd687fb046dcaa88673fe83ea659caec))
* force a new version ([2f2661d](https://github.com/sergienko4/israeli-bank-scrapers/commit/2f2661d25732ac4a8cda399eb93faf7fc45c805a))
* force a new version ([#866](https://github.com/sergienko4/israeli-bank-scrapers/issues/866)) ([a4ab104](https://github.com/sergienko4/israeli-bank-scrapers/commit/a4ab10430888ddca83622d1c3533b0fac4c18c0e))
* force latest supported @types/pupeteer-core ([#736](https://github.com/sergienko4/israeli-bank-scrapers/issues/736)) ([4fe2184](https://github.com/sergienko4/israeli-bank-scrapers/commit/4fe21845c395ae487a64bbf7f689cfd57b0eae4c))
* force publish of library to NPM ([#700](https://github.com/sergienko4/israeli-bank-scrapers/issues/700)) ([5382a2e](https://github.com/sergienko4/israeli-bank-scrapers/commit/5382a2ef5c067072a46a77de75ef5ac102c32ce6))
* handle change password of leumi ([#643](https://github.com/sergienko4/israeli-bank-scrapers/issues/643)) ([19e0de5](https://github.com/sergienko4/israeli-bank-scrapers/commit/19e0de5a9a37958f964ea236587d5f4950eab32b))
* **hapoalim:** balance error for closed accounts ([#641](https://github.com/sergienko4/israeli-bank-scrapers/issues/641)) ([4770a69](https://github.com/sergienko4/israeli-bank-scrapers/commit/4770a698bd438e2c91930578e6af871ad442b7cd))
* **hapoalim:** change from reference number to transaction number ([#787](https://github.com/sergienko4/israeli-bank-scrapers/issues/787)) ([2f9d736](https://github.com/sergienko4/israeli-bank-scrapers/commit/2f9d73638b641c2c770f104a7887f7db12800cee))
* **hapoalim:** only scrape account if it is an active account ([#1022](https://github.com/sergienko4/israeli-bank-scrapers/issues/1022)) ([dd62e9c](https://github.com/sergienko4/israeli-bank-scrapers/commit/dd62e9c2e332d6e407307696ad30f43808b188aa))
* init milliseconds in Leumi dates ([#725](https://github.com/sergienko4/israeli-bank-scrapers/issues/725)) ([d801b76](https://github.com/sergienko4/israeli-bank-scrapers/commit/d801b7677b1db1cd9f4d74ce697e4eb53b6fb785))
* install chromium for macOS workflow ([#860](https://github.com/sergienko4/israeli-bank-scrapers/issues/860)) ([ed29bd0](https://github.com/sergienko4/israeli-bank-scrapers/commit/ed29bd09edad949af3f9dd85719c3abfebe0d830))
* **isracard:** add debug logs for account and transaction fetching ([0bf93a7](https://github.com/sergienko4/israeli-bank-scrapers/commit/0bf93a772bbf38256fcb7df3c0bf65d0926966cc))
* **isracard:** add sleep delays in transaction fetching and account scraping to improve stability ([4d9c948](https://github.com/sergienko4/israeli-bank-scrapers/commit/4d9c948254ae2c48e308d5ac9b48f6bc6dc5e339))
* **isracard:** adjust request abort and continue priority to allow having other interceptors ([44e69aa](https://github.com/sergienko4/israeli-bank-scrapers/commit/44e69aa4e4752918d1f8f811ad8c3db34a5c8639))
* **isracard:** attempt to defeat block-automation ([#1013](https://github.com/sergienko4/israeli-bank-scrapers/issues/1013)) ([dc052c6](https://github.com/sergienko4/israeli-bank-scrapers/commit/dc052c6e04235b09b59ab641bb20fcb1af478fc0))
* **isracard:** blocks headless browser ([#917](https://github.com/sergienko4/israeli-bank-scrapers/issues/917)) ([7e10a58](https://github.com/sergienko4/israeli-bank-scrapers/commit/7e10a58b0c9781f776e3caf9f651078922e3da10))
* **isracard:** improve getExtraScrapAccount by chunking the calls by account&gt;groups of 10 instead of fetching everything once ([5167050](https://github.com/sergienko4/israeli-bank-scrapers/commit/51670507a227136c31d22dd0b2c895bbab00aa4c))
* **isracard:** optimize transaction fetching in getExtraScrapAccount by processing in chunks ([1d0eb03](https://github.com/sergienko4/israeli-bank-scrapers/commit/1d0eb032ca2ee2620befdd49faf9163572c1a56c))
* **isracard:** refactor transaction detail URL ([152e51b](https://github.com/sergienko4/israeli-bank-scrapers/commit/152e51b8be497e8dadc27834e4c23311cd016589))
* **isracard:** remove debug import and enable ([#1016](https://github.com/sergienko4/israeli-bank-scrapers/issues/1016)) ([4a8668b](https://github.com/sergienko4/israeli-bank-scrapers/commit/4a8668b4a21ff8426ec1f50bbd546e2d74f5c54e))
* **isracard:** rename getExtraScrap to getAdditionalTransactionInformation and add opt-in feature for skipping additional transaction information even if `additionalTransactionInformation` is true ([735ac7a](https://github.com/sergienko4/israeli-bank-scrapers/commit/735ac7a63cd788832376d5611f9c49d44ea6d885))
* **Isracard:** use fullPaymentDate if exist for process date ([#726](https://github.com/sergienko4/israeli-bank-scrapers/issues/726)) ([40efeee](https://github.com/sergienko4/israeli-bank-scrapers/commit/40efeee2f91e2308b0acac233548cf9b3de60132))
* **isracard:** use the correct value for `originalCurrency` ([#871](https://github.com/sergienko4/israeli-bank-scrapers/issues/871)) ([79d71a9](https://github.com/sergienko4/israeli-bank-scrapers/commit/79d71a992b2fdfaee54d97c7ea9a3fdaf7c46e14))
* leumi login flow ([#720](https://github.com/sergienko4/israeli-bank-scrapers/issues/720)) ([962e0b4](https://github.com/sergienko4/israeli-bank-scrapers/commit/962e0b40d545b6f48035b5e1826826dc6e91647a))
* Leumi login selector ([#825](https://github.com/sergienko4/israeli-bank-scrapers/issues/825)) ([9c76f6f](https://github.com/sergienko4/israeli-bank-scrapers/commit/9c76f6fa7b366e137e3ce5710b69c87d3840d916))
* leumi new login logic ([#818](https://github.com/sergienko4/israeli-bank-scrapers/issues/818)) ([fe263a8](https://github.com/sergienko4/israeli-bank-scrapers/commit/fe263a81297db6ccde51db26a4a7b37184837dd9))
* leumi.ts multiple account ([#886](https://github.com/sergienko4/israeli-bank-scrapers/issues/886)) ([5590eda](https://github.com/sergienko4/israeli-bank-scrapers/commit/5590edaf36660cfffe31d59296b71c5a447919fb))
* **leumi:** broken leumi login process ([#658](https://github.com/sergienko4/israeli-bank-scrapers/issues/658)) ([e8647c7](https://github.com/sergienko4/israeli-bank-scrapers/commit/e8647c7d31532fa0db64dd6dd66176eb2c27d6b1))
* **leumi:** invalid password detection ([#657](https://github.com/sergienko4/israeli-bank-scrapers/issues/657)) ([4a7b6fd](https://github.com/sergienko4/israeli-bank-scrapers/commit/4a7b6fd3e4fcf5950985f602bf6cb9575db3b2f5))
* **leumi:** post login ([#876](https://github.com/sergienko4/israeli-bank-scrapers/issues/876)) ([80c6757](https://github.com/sergienko4/israeli-bank-scrapers/commit/80c67579b91a329184417dea9ecb8be5bb8fccdc))
* **leumi:** scrape fails on login page scraper:leumi ([#1042](https://github.com/sergienko4/israeli-bank-scrapers/issues/1042)) ([0c8578d](https://github.com/sergienko4/israeli-bank-scrapers/commit/0c8578d0113a80ae5da87fb495a1c022599e8a2a))
* **max:** allow scraping older transactions ([#895](https://github.com/sergienko4/israeli-bank-scrapers/issues/895)) ([f4fd6b5](https://github.com/sergienko4/israeli-bank-scrapers/commit/f4fd6b50adce268a29da7561701b7887e54a2a5e))
* **max:** bad password return GENERAL_ERROR instead CHANGE_PASSWORD ([#847](https://github.com/sergienko4/israeli-bank-scrapers/issues/847)) ([c873557](https://github.com/sergienko4/israeli-bank-scrapers/commit/c873557ac84ea147f6eaf1e32b057d914c50b1e2))
* **max:** failure to fetch transactions ([#629](https://github.com/sergienko4/israeli-bank-scrapers/issues/629)) ([bc268b9](https://github.com/sergienko4/israeli-bank-scrapers/commit/bc268b9bcce89694e4a8d4d78c45f77763eda6cd))
* **max:** Fix login submit button selector ([#905](https://github.com/sergienko4/israeli-bank-scrapers/issues/905)) ([319f849](https://github.com/sergienko4/israeli-bank-scrapers/commit/319f849d58f037422a99e7e42a9fb436044c7a9b))
* **max:** support the new max ui ([#934](https://github.com/sergienko4/israeli-bank-scrapers/issues/934)) ([18f4a94](https://github.com/sergienko4/israeli-bank-scrapers/commit/18f4a9431027c5f64bea57b5204fc0b6bf4c4a36))
* **max:** update url with deprecated version ([#684](https://github.com/sergienko4/israeli-bank-scrapers/issues/684)) ([403c6f8](https://github.com/sergienko4/israeli-bank-scrapers/commit/403c6f85d0039cb110df145ad0b88d5df18e6ccf))
* missing dependencies in deployed package ([b74c01f](https://github.com/sergienko4/israeli-bank-scrapers/commit/b74c01fb48cb593681991593d91c420145d5c4d7))
* mizrahi no pending transactions ([#797](https://github.com/sergienko4/israeli-bank-scrapers/issues/797)) ([66e29d5](https://github.com/sergienko4/israeli-bank-scrapers/commit/66e29d5e4897fba97e6225f2538a661e19637f02))
* Mizrahi scraping issues when user does not need to update the email ([#710](https://github.com/sergienko4/israeli-bank-scrapers/issues/710)) ([f1f6a17](https://github.com/sergienko4/israeli-bank-scrapers/commit/f1f6a178c03086b16e15d183024a7755599386fb))
* **mizrahi-scraper:** update selectors to make it work ([#673](https://github.com/sergienko4/israeli-bank-scrapers/issues/673)) ([e9ea404](https://github.com/sergienko4/israeli-bank-scrapers/commit/e9ea4045bf146c887b95e07a9ee2487b1818819a))
* **mizrahi:** accounts selector ([#821](https://github.com/sergienko4/israeli-bank-scrapers/issues/821)) ([630e1cb](https://github.com/sergienko4/israeli-bank-scrapers/commit/630e1cbfa533491ff61aea4c5e48109c6a4ef162))
* **mizrahi:** allow transactions without yitra ([#804](https://github.com/sergienko4/israeli-bank-scrapers/issues/804)) ([64165bc](https://github.com/sergienko4/israeli-bank-scrapers/commit/64165bc39db27abe38b4a7dd98164ec8319f31c2))
* **mizrahi:** fix transaction identifier ([10af493](https://github.com/sergienko4/israeli-bank-scrapers/commit/10af49334446c79451db8b3834095d71c2f90113))
* **mizrahi:** fix transaction identifier ([#1052](https://github.com/sergienko4/israeli-bank-scrapers/issues/1052)) ([927e1db](https://github.com/sergienko4/israeli-bank-scrapers/commit/927e1db38a6358dc17c946493117d2871ed787ba))
* **mizrahi:** mark transactions as pending if they have no identifier ([#991](https://github.com/sergienko4/israeli-bank-scrapers/issues/991)) ([31ae112](https://github.com/sergienko4/israeli-bank-scrapers/commit/31ae1122aaf76e41cd62c092326f27ccb1bd7729))
* **mizrahi:** parse transaction amount as float instead of integer ([fad87ed](https://github.com/sergienko4/israeli-bank-scrapers/commit/fad87ed88a6e88b0f383ffcd459a49620fa6a77e))
* **mizrahi:** parse transaction amount as float instead of integer ([#1009](https://github.com/sergienko4/israeli-bank-scrapers/issues/1009)) ([5facdda](https://github.com/sergienko4/israeli-bank-scrapers/commit/5facdda44487fba4d517f5fb0bfb94fa026bc233))
* **mizrahi:** repaired balance / account number reading ([#803](https://github.com/sergienko4/israeli-bank-scrapers/issues/803)) ([bc841a6](https://github.com/sergienko4/israeli-bank-scrapers/commit/bc841a61b8a7d9338070d32131b37eee8c7e53ab))
* **mizrahi:** scrape all pending transactions, skip pending with no date ([#1008](https://github.com/sergienko4/israeli-bank-scrapers/issues/1008)) ([a5d1f01](https://github.com/sergienko4/israeli-bank-scrapers/commit/a5d1f01ac7bc51a884ccbb1da15723c7f2896be8))
* **mizrahi:** update account number selector and add error handling ([#889](https://github.com/sergienko4/israeli-bank-scrapers/issues/889)) ([28fd0e9](https://github.com/sergienko4/israeli-bank-scrapers/commit/28fd0e943e2996b7be7f1f8828d324b57e2846b4))
* **mizrahi:** update selectors for username, password, and submit button ([#1007](https://github.com/sergienko4/israeli-bank-scrapers/issues/1007)) ([4eecf2c](https://github.com/sergienko4/israeli-bank-scrapers/commit/4eecf2cca19b72749fcfae0ee3f13a21b0e677f7))
* **mizrahi:** wait for OSH page to load before fetching account ([#870](https://github.com/sergienko4/israeli-bank-scrapers/issues/870)) ([b7ebd71](https://github.com/sergienko4/israeli-bank-scrapers/commit/b7ebd7125adfb3e66d8f61233d530d0a1aa92cf2))
* new cal api amount field ([#776](https://github.com/sergienko4/israeli-bank-scrapers/issues/776)) ([23553f9](https://github.com/sergienko4/israeli-bank-scrapers/commit/23553f93ab2545b78acc0e3dddad87d54ed997d1))
* **one-zero:** transaction identifier ([#879](https://github.com/sergienko4/israeli-bank-scrapers/issues/879)) ([4315476](https://github.com/sergienko4/israeli-bank-scrapers/commit/43154762ea7027f3a7db8fa2b48730647f45e567))
* **otsar-hahayal:** updated success url ([#856](https://github.com/sergienko4/israeli-bank-scrapers/issues/856)) ([abdf74e](https://github.com/sergienko4/israeli-bank-scrapers/commit/abdf74e12ddf4d4b98f3dd3677f99c6777f2e5b3))
* **otsar-hahayal:** waiting a second before clicking the login button ([#752](https://github.com/sergienko4/israeli-bank-scrapers/issues/752)) ([f475e08](https://github.com/sergienko4/israeli-bank-scrapers/commit/f475e08e6f28b6807b6c65a6c394f2072789728b))
* **otsar:** fixed otsar new UI ([ce5d7cd](https://github.com/sergienko4/israeli-bank-scrapers/commit/ce5d7cd4071dfabe0bdaa4abbfb77a719fc356dd))
* ratchet coverage thresholds to prevent regression ([#29](https://github.com/sergienko4/israeli-bank-scrapers/issues/29)) ([ed824c8](https://github.com/sergienko4/israeli-bank-scrapers/commit/ed824c837e3d780921e242dd7ab2c35f9132e840))
* re-added missing 'onProgress' method to new scraper interface ([#774](https://github.com/sergienko4/israeli-bank-scrapers/issues/774)) ([5d8c67a](https://github.com/sergienko4/israeli-bank-scrapers/commit/5d8c67ab5aba3bab4bafd3575670a3073245e3b9))
* replace node-fetch with native fetch() API ([#41](https://github.com/sergienko4/israeli-bank-scrapers/issues/41)) ([9e12cef](https://github.com/sergienko4/israeli-bank-scrapers/commit/9e12cefd260c5890d0ea35c0f995160badf07fd6))
* resolve Jest 30 test-exclude crash on Node 22 ([#45](https://github.com/sergienko4/israeli-bank-scrapers/issues/45)) ([e146bf2](https://github.com/sergienko4/israeli-bank-scrapers/commit/e146bf2529f015c9010050127b829d35dd4b217c))
* **scrapers/leumi:** support logging in to business account ([#737](https://github.com/sergienko4/israeli-bank-scrapers/issues/737)) ([c688b93](https://github.com/sergienko4/israeli-bank-scrapers/commit/c688b93b5a5124a52c7536c21ef83b148c9c5e46))
* **scrapers/mizrahi:** remove update email page fix for now ([#727](https://github.com/sergienko4/israeli-bank-scrapers/issues/727)) ([844bf37](https://github.com/sergienko4/israeli-bank-scrapers/commit/844bf37857f2128a75ed8336a82b0601ceb4844e))
* **scraper:** simplify navigateTo method by removing unused parameters ([0fb738f](https://github.com/sergienko4/israeli-bank-scrapers/commit/0fb738f00c1c85a5382d9c665ed2072c67290a14))
* **scraper:** update waitForPostLogin to correctly handle element visibility ([daa797a](https://github.com/sergienko4/israeli-bank-scrapers/commit/daa797acefaef2fcba872e3bb9a8d3ed36203a3d))
* surface network errors in fetchPostWithinPage and fix Amex login diagnostics ([#61](https://github.com/sergienko4/israeli-bank-scrapers/issues/61)) ([4da69dd](https://github.com/sergienko4/israeli-bank-scrapers/commit/4da69dd4a5738a0cb4d76813c2dce709cabbb4a3))
* throw error browser version mismatches Playwright's expected Chromium ([#59](https://github.com/sergienko4/israeli-bank-scrapers/issues/59)) ([a15b018](https://github.com/sergienko4/israeli-bank-scrapers/commit/a15b01843f7e4c31612069bf7b38432473d700e2))
* update change password detection ([#688](https://github.com/sergienko4/israeli-bank-scrapers/issues/688)) ([2c5167f](https://github.com/sergienko4/israeli-bank-scrapers/commit/2c5167fdbffce9d14340e96529ab8f3a5e40521e))
* update discount login url ([#730](https://github.com/sergienko4/israeli-bank-scrapers/issues/730)) ([3a25b48](https://github.com/sergienko4/israeli-bank-scrapers/commit/3a25b48af1faa53e8197d0e7faacc71a08fc6bb6))
* update Node to 22.14.0 for npm Trusted Publishing support ([37625ba](https://github.com/sergienko4/israeli-bank-scrapers/commit/37625ba2ea040259d61a7d85fb4abc7b8c1534b6))
* update yahav elements to match UI changes ([#703](https://github.com/sergienko4/israeli-bank-scrapers/issues/703)) ([40f5275](https://github.com/sergienko4/israeli-bank-scrapers/commit/40f5275ff0fd5fcf28179c57573836ca1431c833))
* use better selector to prevent race condition when login to leumi ([#689](https://github.com/sergienko4/israeli-bank-scrapers/issues/689)) ([087a5c8](https://github.com/sergienko4/israeli-bank-scrapers/commit/087a5c83e036a951f10856ffe0d13d58d4a398d9))
* visa cal timeout due to a change in the iframe URL ([#704](https://github.com/sergienko4/israeli-bank-scrapers/issues/704)) ([9ef15c0](https://github.com/sergienko4/israeli-bank-scrapers/commit/9ef15c0d729b4ba06ac3aedf3becf0ca6e6728b3))
* visa Cal wrong day of transaction, and missing fields  ([#783](https://github.com/sergienko4/israeli-bank-scrapers/issues/783)) ([6b961fd](https://github.com/sergienko4/israeli-bank-scrapers/commit/6b961fd7318cc522ac12de83498c1e6c2316ac68))
* **visa-cal:** better handling of authmodule waiting ([#980](https://github.com/sergienko4/israeli-bank-scrapers/issues/980)) ([8584f09](https://github.com/sergienko4/israeli-bank-scrapers/commit/8584f09a51c629f96c9957c8af5faf686e6c44b4))
* **visa-cal:** cannot read properties of null ('bankIssuedCards') ([#1041](https://github.com/sergienko4/israeli-bank-scrapers/issues/1041)) ([77bddbb](https://github.com/sergienko4/israeli-bank-scrapers/commit/77bddbbb115f2949e52ecc4c20355401ace66236))
* **visa-cal:** improve scraper success rate ([#619](https://github.com/sergienko4/israeli-bank-scrapers/issues/619)) ([308e508](https://github.com/sergienko4/israeli-bank-scrapers/commit/308e508d4b5a7719c2236389a9edbd06b814394f))
* **visa-cal:** improve token waiting ([#1014](https://github.com/sergienko4/israeli-bank-scrapers/issues/1014)) ([e365d1b](https://github.com/sergienko4/israeli-bank-scrapers/commit/e365d1b00e849a56c60b8482571de65d5f692b03))
* **visa-cal:** increase getCards session storage timeout 10s → 30s ([#66](https://github.com/sergienko4/israeli-bank-scrapers/issues/66)) ([a8fc4e5](https://github.com/sergienko4/israeli-bank-scrapers/commit/a8fc4e572c363dcf9ee99e2f70c894aca9d8efe1))
* **visa-cal:** scrape multiple accounts for visa cal ([#615](https://github.com/sergienko4/israeli-bank-scrapers/issues/615)) ([1da0b0d](https://github.com/sergienko4/israeli-bank-scrapers/commit/1da0b0dc4cba7c8e283290e4e85134eb9e2a243c))
* **visa-cal:** scraper crash when bankIssuedCards is null ([#1037](https://github.com/sergienko4/israeli-bank-scrapers/issues/1037)) ([d33de76](https://github.com/sergienko4/israeli-bank-scrapers/commit/d33de760c2bc6190d07716658f284277f3c8c14f))
* **visa-cal:** settlement date issue when changing billing cycle on cal cards ([#653](https://github.com/sergienko4/israeli-bank-scrapers/issues/653)) ([d371843](https://github.com/sergienko4/israeli-bank-scrapers/commit/d371843424da5c8d44df3daf6a1be7179353a607))
* **visa-cal:** update button selector for next time button ([#913](https://github.com/sergienko4/israeli-bank-scrapers/issues/913)) ([e85a573](https://github.com/sergienko4/israeli-bank-scrapers/commit/e85a573a7c14cd52b9641fa3c47f8b56677219c1))
* **visa-cal:** update User-Agent and add additional headers for improved request handling ([d4927af](https://github.com/sergienko4/israeli-bank-scrapers/commit/d4927afa14aeb63c52c88c9eae588c0eb780cebf))
* **visa-cal:** use different login api to solve scraping issues ([#601](https://github.com/sergienko4/israeli-bank-scrapers/issues/601)) ([33ed47f](https://github.com/sergienko4/israeli-bank-scrapers/commit/33ed47f99809f65655364477573ecf15a48ab67c))
* visaCal - add missing credit transactions and fix the amount field for credits ([#808](https://github.com/sergienko4/israeli-bank-scrapers/issues/808)) ([9cbceaa](https://github.com/sergienko4/israeli-bank-scrapers/commit/9cbceaae54ce596d870a167ba6271b41cf7ca273))
* **visaCal:** enhance authorization handling and type safety ([b40bfab](https://github.com/sergienko4/israeli-bank-scrapers/commit/b40bfabcdde190602ccd3031b5097026b7710557))
* **visaCal:** improve token waiting ([185bfeb](https://github.com/sergienko4/israeli-bank-scrapers/commit/185bfeb63755823ef9ab4d0b118e77e06f350891))
* Workaround for Mizrahi bank API bug which returns transactions before the start date ([#606](https://github.com/sergienko4/israeli-bank-scrapers/issues/606)) ([7c6bc3e](https://github.com/sergienko4/israeli-bank-scrapers/commit/7c6bc3e8e277ff123219b56ae3dcbfa822fffdd8))
* **yahav:** account selector ([#882](https://github.com/sergienko4/israeli-bank-scrapers/issues/882)) ([199f10b](https://github.com/sergienko4/israeli-bank-scrapers/commit/199f10b3b9c73696e00322c2ee42dca5fb6afbfe))


### Code Refactoring

* remove old banks keys ([#899](https://github.com/sergienko4/israeli-bank-scrapers/issues/899)) ([1737fd7](https://github.com/sergienko4/israeli-bank-scrapers/commit/1737fd7c188071964527d8a9776e4211748663b9))


### Miscellaneous

* upgrade to node v16 ([#798](https://github.com/sergienko4/israeli-bank-scrapers/issues/798)) ([feed09d](https://github.com/sergienko4/israeli-bank-scrapers/commit/feed09d3a6775464eaee02420c338f523fac9208))

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
