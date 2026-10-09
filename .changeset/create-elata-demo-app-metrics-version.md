---
"@elata-biosciences/create-elata-demo": patch
---

`create-elata-demo` starts again when run from npm: `index.mjs` reads an `appMetrics` version that `elataSdkVersions` did not list, so every template stopped at start outside the monorepo. The version is listed, and a test fails if the CLI ever reads a version that is not packaged.
