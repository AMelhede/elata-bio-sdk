---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.16: test.15 plus fixes from a review of everything since test.13. The heart-rate path while a session runs is unchanged, so results measured on test.15 hold for it.
- A session whose engine failed reports no number. The runner stops on the error, so the pulse check kept its last proven rate and `getMetrics()` returned it as if live; it now returns every rate cleared (`backend_failed` in `reason_codes`), and `getExperimentalVitals()` gives no HRV.
- `getDiagnostics().faceGone`: true once no face has been in view long enough that `getMetrics()` reports no rate (one second). A status keyed on `lastDropReason`, which describes one frame, flashed "No face in view" beside a live rate on a single missed frame; the demo page uses `faceGone`, and says so before the capture score's advice, which stops updating while no face is seen.
- The face-tracking failure guidance no longer recommends `faceMesh: 'off'` alone, which shows no heart rate with the pulse check on.
- Docs: what an unavailable WASM engine means with the pulse check on (its rate can still come); the 20 to 40 s wait and the WASM error in llms.txt; HRV conditions with `pulseCheck: false` in the type docs.
- Release check: refuses a source module with no build, a built file not committed, a dist changed after the build, and a banned sentence in package.json; the build re-emits every file.
