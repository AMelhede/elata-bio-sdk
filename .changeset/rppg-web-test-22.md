---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.22: test.21 plus two changes, each with its own entry: the trial face finder's 2 s time budget per candidate (on a heavily throttled device the trial alone held the face finder to about 0.3 frames a second for a whole reading; with the budget about 2.7, unchanged on an unthrottled one), and pulse check rule screenLight (a pulseless face lit by a changing screen showed a rate; a window where one light steps on the whole face, as held new levels and counted once per change, is not evidence). create-elata-demo is unchanged and still installs test.21.
