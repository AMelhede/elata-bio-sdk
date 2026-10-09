---
"@elata-biosciences/rppg-web": patch
---

The package's demo page shows the session's checked heart rate (`session.getMetrics()`), with no mood, breathing, HRV-based arousal, engine confidence or signal-quality readouts, and `initDemo` no longer runs the engine's rate tracker, which does not move the rate the page shows. The status says when no face is in view and "Looking for a pulse" until one is proven; it used to sit at "Calibrating... 0%" in front of a wall. In headless Chromium with a fake camera: a 70 bpm face read a median 69, first shown at 22 s; a bare wall showed no rate in 60 s.
