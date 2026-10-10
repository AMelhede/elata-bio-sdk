---
"@elata-biosciences/create-elata-demo": patch
---

`npx @elata-biosciences/create-elata-demo` (and `npm create @elata-biosciences/elata-demo`) works again. Every release from 0.3.1 to 0.12.1 crashed on start, for every template and every command including `--list-templates`, unless `@elata-biosciences/app-metrics` happened to be installed beside it: the CLI reads an `app-metrics` version on start that the package did not carry.
