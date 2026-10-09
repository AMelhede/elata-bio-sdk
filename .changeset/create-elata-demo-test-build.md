---
"@elata-biosciences/create-elata-demo": patch
---

Test build packaging on release/test-1: published as `@amelhede/create-elata-demo` 0.12.2-test.1 under the `test` tag, with Elata's MIT LICENSE in the package (the published 0.12.1 ships without the notice). `prepack` runs `scripts/check-test-release.mjs`; `prepublishOnly` adds `--publish`, which refuses the `latest` tag and refuses to publish while any package version a starter installs is missing from npm. PUBLISHING.md gives the one-line publish, to run after the rppg-web test build is approved.
