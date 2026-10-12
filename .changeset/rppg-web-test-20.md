---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.20: test.19 plus two changes, each with its own entry. On the test.19 audit's harness (the build's own DemoRunner, RppgProcessor and RppgSession with the real WASM in Node, synthetic faces: 66 bpm with a 10 s face gap, steady 72, no pulse with and without a gap, one timestamp that is not a number, a 10 s spell with no fusion region, no fusion, no engine, and 15, 20, 24 and 60 frames a second), every field of every per-second read and the digest of every read are the same as test.19 in all 48 runs at the published options, the fixes off, the defaults and the pulse check on or off, and in all 13 runs with `rgbPulse` on. Neither change is reached by a synthetic face whose pulse points the way blood's does and has no clipped frame; each one's own tests show what moves.
- The pulse check's face flicker rule withholds at a brightness / colour ratio over 7 instead of 10: a 2% lamp at 90 bpm with no pulse, whose colour part points the way blood's does at 0.1 of its brightness swing, was shown in 40 of 60 s (88.7 to 90.0) and is now shown in none.
- `fixes.rgbPulse` (off by default): a frame with R = G = B in a colour feed, such as one clipped white, gives 0 instead of its own level; one such frame used to leave a 72 with no rate for the rest of the window.
