# [0.11.0](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.10.0...v0.11.0) (2026-06-17)


### Features

* add auto-stash manager ([#107](https://github.com/zaknafeyn/git-smart-checkout/issues/107)) ([103fccb](https://github.com/zaknafeyn/git-smart-checkout/commit/103fccbdd231094bc2a1064a7a8e234095c99f63))
* **jira:** store Jira API token in VS Code Secret Storage ([#106](https://github.com/zaknafeyn/git-smart-checkout/issues/106)) ([738e31e](https://github.com/zaknafeyn/git-smart-checkout/commit/738e31e6c1254da899d983a5bb734a4b43a5b3c7))
* **status-bar:** add all worktree commands and Open Settings to quick actions menu ([#112](https://github.com/zaknafeyn/git-smart-checkout/issues/112)) ([fcc1fe8](https://github.com/zaknafeyn/git-smart-checkout/commit/fcc1fe874ae9dad9c2c4a76d16b8c89f7810d0e6))

# [0.10.0](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.9.0...v0.10.0) (2026-06-15)


### Features

* add "Remove Multiple Worktrees..." command ([#110](https://github.com/zaknafeyn/git-smart-checkout/issues/110)) ([0dd8f14](https://github.com/zaknafeyn/git-smart-checkout/commit/0dd8f140b54e21f66b715a1f1fb3742eca5419d8))
* **pr-clone:** pre-fill description from PR template with markdown preview ([#109](https://github.com/zaknafeyn/git-smart-checkout/issues/109)) ([b6dcadd](https://github.com/zaknafeyn/git-smart-checkout/commit/b6dcaddc47ff812a27cda85f18234ee795ac836d))
* **status-bar:** open a quick-actions menu from the status bar item ([#108](https://github.com/zaknafeyn/git-smart-checkout/issues/108)) ([ea75196](https://github.com/zaknafeyn/git-smart-checkout/commit/ea751961a97b5d038d3e986f758409a571f582f1))

# [0.9.0](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.8.1...v0.9.0) (2026-06-13)


### Features

* **analytics:** emit events for all remaining commands ([#104](https://github.com/zaknafeyn/git-smart-checkout/issues/104)) ([41247fc](https://github.com/zaknafeyn/git-smart-checkout/commit/41247fc8362760a57ab6b478a02551562ed02620))

## [0.8.1](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.8.0...v0.8.1) (2026-06-13)


### Bug Fixes

* address assorted review defects ([#99](https://github.com/zaknafeyn/git-smart-checkout/issues/99)) ([9ee5391](https://github.com/zaknafeyn/git-smart-checkout/commit/9ee53919c51e67f7e3608c3a5ae6efe89c674ccd))
* **deps:** resolve esbuild and qs Dependabot alerts ([#103](https://github.com/zaknafeyn/git-smart-checkout/issues/103)) ([11c791c](https://github.com/zaknafeyn/git-smart-checkout/commit/11c791c1aa838c0fc03bb1639d72c8510127fa3d))
* handle temp worktree clone cancellation ([#96](https://github.com/zaknafeyn/git-smart-checkout/issues/96)) ([7272906](https://github.com/zaknafeyn/git-smart-checkout/commit/727290670f12caf605689098d5a586b6cf1823b3))
* recover from in-place PR clone failures ([#89](https://github.com/zaknafeyn/git-smart-checkout/issues/89)) ([35143be](https://github.com/zaknafeyn/git-smart-checkout/commit/35143bea8f20aa1879dad8d3eed9f498f66c0522))
* reject cross-repository PR URLs ([#98](https://github.com/zaknafeyn/git-smart-checkout/issues/98)) ([3f76d43](https://github.com/zaknafeyn/git-smart-checkout/commit/3f76d4317a01417e365325efbed781471d4bf5e6))

# [0.8.0](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.7.2...v0.8.0) (2026-06-13)


### Bug Fixes

* allow checking out tags from "Checkout to..." ([#83](https://github.com/zaknafeyn/git-smart-checkout/issues/83)) ([704edc5](https://github.com/zaknafeyn/git-smart-checkout/commit/704edc532eb1fad4a88834d05e8676f13c6d5690))
* check remote-branch existence against the correct ref ([#81](https://github.com/zaknafeyn/git-smart-checkout/issues/81)) ([753f288](https://github.com/zaknafeyn/git-smart-checkout/commit/753f28893a16246a7c32f5f40e0ae1d50d4f3b79)), closes [#checkRemoteBranchExists](https://github.com/zaknafeyn/git-smart-checkout/issues/checkRemoteBranchExists)
* correct status bar theme background ([#95](https://github.com/zaknafeyn/git-smart-checkout/issues/95)) ([9be7c3b](https://github.com/zaknafeyn/git-smart-checkout/commit/9be7c3b28a8ebfa538d5f853c30c9f81acb91b96))
* correctly detect in-progress cherry-pick via CHERRY_PICK_HEAD ([#92](https://github.com/zaknafeyn/git-smart-checkout/issues/92)) ([2c325c7](https://github.com/zaknafeyn/git-smart-checkout/commit/2c325c70a5b15968f5161737dae35b84921a5065))
* handle stash preview fatal errors ([#90](https://github.com/zaknafeyn/git-smart-checkout/issues/90)) ([5856478](https://github.com/zaknafeyn/git-smart-checkout/commit/58564780666867cb295999b88b7d544fe1e07014))
* paginate GitHub PR commits and labels to avoid dropping data ([#80](https://github.com/zaknafeyn/git-smart-checkout/issues/80)) ([5906fb8](https://github.com/zaknafeyn/git-smart-checkout/commit/5906fb8a62572a4dddc475b7dfd30afceda0bdb0))
* parse diverged branch tracking counts ([#84](https://github.com/zaknafeyn/git-smart-checkout/issues/84)) ([08d38bc](https://github.com/zaknafeyn/git-smart-checkout/commit/08d38bc2fbb5e6da458211986c973d4b4388faee))
* parse dotted GitHub repository names ([#88](https://github.com/zaknafeyn/git-smart-checkout/issues/88)) ([4cc273a](https://github.com/zaknafeyn/git-smart-checkout/commit/4cc273ad1c1a95f7b4865a34d3ed8e9010591b5c))
* preserve cloned PR metadata ([#87](https://github.com/zaknafeyn/git-smart-checkout/issues/87)) ([6953350](https://github.com/zaknafeyn/git-smart-checkout/commit/6953350ae42a09dd34fbfcba445dd9c8029a508b))
* preserve colons in stash messages ([#85](https://github.com/zaknafeyn/git-smart-checkout/issues/85)) ([a81242e](https://github.com/zaknafeyn/git-smart-checkout/commit/a81242e2f94d782cd2c385f89fdc629ca6ee04a8))
* preserve PR commit order ([#97](https://github.com/zaknafeyn/git-smart-checkout/issues/97)) ([c0330ca](https://github.com/zaknafeyn/git-smart-checkout/commit/c0330ca56503a4f413fe036f2cfbb75e0c4c8ff1))
* prevent data loss when cancelling PR clone in temp-worktree mode ([#79](https://github.com/zaknafeyn/git-smart-checkout/issues/79)) ([6b9e261](https://github.com/zaknafeyn/git-smart-checkout/commit/6b9e261387b8e1f0f2d27f5475eee3e5b6d59f39))
* reinitialize PR clone services per repository ([#94](https://github.com/zaknafeyn/git-smart-checkout/issues/94)) ([b09bd5c](https://github.com/zaknafeyn/git-smart-checkout/commit/b09bd5cd94838dde65b2c06a44c9e277175f5181))
* stabilize PR clone progress handles ([#86](https://github.com/zaknafeyn/git-smart-checkout/issues/86)) ([79330ff](https://github.com/zaknafeyn/git-smart-checkout/commit/79330ff4b348858938a6b751fefc11b52d2df3ef))
* stop PR fetch spinner on errors ([#93](https://github.com/zaknafeyn/git-smart-checkout/issues/93)) ([2cc901c](https://github.com/zaknafeyn/git-smart-checkout/commit/2cc901c34cfa88050f8aa62badda8a47e7bd3e3f))
* use 24-hour stash timestamps ([#91](https://github.com/zaknafeyn/git-smart-checkout/issues/91)) ([f0ce549](https://github.com/zaknafeyn/git-smart-checkout/commit/f0ce5493dcb85a32c8c0665b4ded84e7d711ad08))
* use a non-printable separator for ref list parsing ([#82](https://github.com/zaknafeyn/git-smart-checkout/issues/82)) ([245700d](https://github.com/zaknafeyn/git-smart-checkout/commit/245700d7deedd376b52ba48eccc7dc426142211d))


### Features

* add command to copy current branch name to clipboard ([#77](https://github.com/zaknafeyn/git-smart-checkout/issues/77)) ([918a173](https://github.com/zaknafeyn/git-smart-checkout/commit/918a173309aa62581d48c4b694d5e5f5ca270c3a)), closes [#76](https://github.com/zaknafeyn/git-smart-checkout/issues/76)
* allow editing prefilled tag name on tag creation ([#100](https://github.com/zaknafeyn/git-smart-checkout/issues/100)) ([3f6a13c](https://github.com/zaknafeyn/git-smart-checkout/commit/3f6a13cd44cbc614543dec119cd7541a1c6e3565))
* sort Jira picker newest-first and add project key filter ([#78](https://github.com/zaknafeyn/git-smart-checkout/issues/78)) ([aee7b04](https://github.com/zaknafeyn/git-smart-checkout/commit/aee7b04b4b2a2d519b4da561cbd1a96a18124c89))

## [0.7.2](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.7.1...v0.7.2) (2026-06-06)


### Bug Fixes

* rename command category to GSC ([#75](https://github.com/zaknafeyn/git-smart-checkout/issues/75)) ([9730184](https://github.com/zaknafeyn/git-smart-checkout/commit/973018436f3b9e16f4086873e4cd5530f0977ed1)), closes [#70](https://github.com/zaknafeyn/git-smart-checkout/issues/70)

## [0.7.1](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.7.0...v0.7.1) (2026-06-06)


### Bug Fixes

* correct recurring token naming and remove duplicate Cancel button ([#74](https://github.com/zaknafeyn/git-smart-checkout/issues/74)) ([a691db6](https://github.com/zaknafeyn/git-smart-checkout/commit/a691db66cb4f58e8b48588870c91254540b7fdba))

# [0.7.0](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.6.0...v0.7.0) (2026-05-31)


### Features

* add 'Create Branch from Template' command and Jira integration ([#67](https://github.com/zaknafeyn/git-smart-checkout/issues/67)) ([b2b889b](https://github.com/zaknafeyn/git-smart-checkout/commit/b2b889ba23b70676b15672cd19cda32031a253f1))
* enhance branch management with preferred refs and new commands ([#68](https://github.com/zaknafeyn/git-smart-checkout/issues/68)) ([0c6691d](https://github.com/zaknafeyn/git-smart-checkout/commit/0c6691d239574cf0446efaf8d608c1bfa82095ec))

# [0.6.0](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.5.1...v0.6.0) (2026-05-30)


### Bug Fixes

* include locale in analytics initialization and enable geoip properties ([860d088](https://github.com/zaknafeyn/git-smart-checkout/commit/860d088d33d59b9c28293341eb681ff9b9b3441f))
* update execCommand to use execFile and improve argument handling ([#63](https://github.com/zaknafeyn/git-smart-checkout/issues/63)) ([ad8bf54](https://github.com/zaknafeyn/git-smart-checkout/commit/ad8bf542836b7fcb86e706833fa2aadfa6bc0ae8))


### Features

* add 'Open Worktree Dev Terminal' command and documentation ([#62](https://github.com/zaknafeyn/git-smart-checkout/issues/62)) ([f623535](https://github.com/zaknafeyn/git-smart-checkout/commit/f623535b97c815b48be974e6b4b4cdca3958742e))
* implement worktree branch conflict handling in checkout commands ([#64](https://github.com/zaknafeyn/git-smart-checkout/issues/64)) ([d9d5558](https://github.com/zaknafeyn/git-smart-checkout/commit/d9d5558472b6879e7e03895fecb5c8ad59f2b38f))
* Refactor configuration management and enhance ref details caching ([#65](https://github.com/zaknafeyn/git-smart-checkout/issues/65)) ([1f52ce6](https://github.com/zaknafeyn/git-smart-checkout/commit/1f52ce6cc48e880e4739fe39a44585cc0088eb16))

## [0.5.1](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.5.0...v0.5.1) (2026-05-19)


### Bug Fixes

* capture extension activation event in analytics ([477a054](https://github.com/zaknafeyn/git-smart-checkout/commit/477a054f89710d11fdd51c4ada827680873ed5a7))

# [0.5.0](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.4.0...v0.5.0) (2026-05-11)


### Bug Fixes

* update command names to include 'Git Smart Checkout' prefix for consistency ([401a842](https://github.com/zaknafeyn/git-smart-checkout/commit/401a842be7faa7b3264fd55eff31c15e8ae15058))


### Features

* pr review in worktree ([#50](https://github.com/zaknafeyn/git-smart-checkout/issues/50)) ([31e9929](https://github.com/zaknafeyn/git-smart-checkout/commit/31e992995e0dc996010314f270d38364dcd43afc))
* update website with new icon and add 'Pull with Rebase' feature ([#46](https://github.com/zaknafeyn/git-smart-checkout/issues/46)) ([fa474e7](https://github.com/zaknafeyn/git-smart-checkout/commit/fa474e7a218c5e0b54aee2330fcf1c5588907ebb))

# [0.4.0](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.3.0...v0.4.0) (2026-05-10)


### Features

* implement error handling with issue reporting in showErrorMessage ([#47](https://github.com/zaknafeyn/git-smart-checkout/issues/47)) ([108faa8](https://github.com/zaknafeyn/git-smart-checkout/commit/108faa89d0aa502e0590127c3a6db94b2e5b3967))
* smart checkout to worktree ([#49](https://github.com/zaknafeyn/git-smart-checkout/issues/49)) ([25e8e12](https://github.com/zaknafeyn/git-smart-checkout/commit/25e8e120d82c4172aaf69caaa6ccddf810758aea))
* update extension settings section with clickable links for easier access ([5c9bc0c](https://github.com/zaknafeyn/git-smart-checkout/commit/5c9bc0c9bebcf3d8a38314bae6d91b60602faf9d))

# [0.3.0](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.2.3...v0.3.0) (2026-05-08)


### Bug Fixes

* update release workflow to trigger on workflow_dispatch instead of push ([6d79f4d](https://github.com/zaknafeyn/git-smart-checkout/commit/6d79f4db69f99de36d0b024c1d5d5b7aed4622bd))


### Features

* add 'Pull (Rebase With Stash)' command with automatic stash handling ([#44](https://github.com/zaknafeyn/git-smart-checkout/issues/44)) ([4a868e5](https://github.com/zaknafeyn/git-smart-checkout/commit/4a868e5fe790f8acd92905d5f1e6eb4ad431e1f0))
* allow user to copy created tag to clipboard and update confirmation messages ([#43](https://github.com/zaknafeyn/git-smart-checkout/issues/43)) ([3606ba2](https://github.com/zaknafeyn/git-smart-checkout/commit/3606ba293647327f25d1c98989359b431d77dfde))
* enhance documentation for commands with stash support ([#45](https://github.com/zaknafeyn/git-smart-checkout/issues/45)) ([43677b1](https://github.com/zaknafeyn/git-smart-checkout/commit/43677b1326dfb566dc518f8e616b9261583031bc))

## [0.2.3](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.2.2...v0.2.3) (2026-05-07)


### Bug Fixes

* update icon file and improve .vscodeignore entries to reduce bundle size ([00f2525](https://github.com/zaknafeyn/git-smart-checkout/commit/00f2525272e288110fdf7e10ae267bac35e7b4eb))

## [0.2.2](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.2.1...v0.2.2) (2026-05-07)


### Bug Fixes

* Update publish command to include --packagePath for VS Code extension ([db6a00b](https://github.com/zaknafeyn/git-smart-checkout/commit/db6a00b4dbecca8192cb80742e79ecd82eb0eb17))

## [0.2.1](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.2.0...v0.2.1) (2026-05-07)


### Bug Fixes

* Correct environment variable references in publish command for VS Code extension ([f69dd7b](https://github.com/zaknafeyn/git-smart-checkout/commit/f69dd7b7d02df8940b86f9bb00f5642e261cfaec))

# [0.2.0](https://github.com/zaknafeyn/git-smart-checkout/compare/v0.1.23...v0.2.0) (2026-05-07)


### Features

* Add GitHub App token generation step in release workflow ([7776544](https://github.com/zaknafeyn/git-smart-checkout/commit/77765448256adcf17adbc4ddc02b271e6455b45d))
* Implement structure for code changes with placeholders for future updates, update versioning ([4f9819d](https://github.com/zaknafeyn/git-smart-checkout/commit/4f9819dfccc1ee926b6867b0bad23b76ff5130d8))
