---
"@elata-biosciences/create-elata-demo": patch
---

0.12.2-test.2: starters install `@amelhede/rppg-web` 0.15.0-test.18. A `.DS_Store`, `Thumbs.db` or `desktop.ini` beside the templates no longer makes the release check (`prepack`, `prepublishOnly`) refuse the package, and `Thumbs.db` and `desktop.ini`, which npm would otherwise pack, are kept out of the package and so out of every starter.
