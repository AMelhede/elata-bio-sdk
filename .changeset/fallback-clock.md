---
"@elata-biosciences/rppg-web": patch
---

Where the browser has no `requestVideoFrameCallback` (Safari before 15.4, Firefox before 132), both frame sources' timer fallback stamped frames with `Date.now()` while every other time in the library is `performance.now()` (the clock the callback gives). In a browser this froze the page: with the callback hidden, the default demo page never showed its rate display and could not be read for 30 s; with `Date.now` made equal to `performance.now` it ran normally. The fallback now stamps with `performance.now()`. Same code in published 0.14.0 and Elata's main.
