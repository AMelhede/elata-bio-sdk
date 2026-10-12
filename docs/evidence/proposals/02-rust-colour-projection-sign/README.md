# Fix 2. The WASM core's colour projection subtracts

- **Problem.** The core's CHROM step adds alpha times Y where the published recipe (de Haan and Jeanne 2013), and
  the SDK's own JavaScript `ChromPulseModel`, subtract. So a lamp's flicker can beat the pulse.
- **Fix.** Subtract. Samples that are already extracted (R = G = B) pass through unprojected.
- **Verdict.** Strong.
- **Strongest evidence** [synthetic]. A true 90 under a lamp at 60 reads 67 every second on 0.14.0, and 88 to 93 with
  the fix (14 of the last 15 s within 5 bpm). Three new Rust tests are red with main's sign. The default fused path
  is bit for bit main: 210 of 210 seeded runs equal.
- **Cost.** No API or default change. On the camera-colour path with no lamp, more numbers appear: 476 shown against
  259 of 480 s, 140 right against 39, 336 wrong against 220; 88 of the 116 extra wrong seconds go when the harmonic
  picker is switched off (see the issue).
- **Still open.** No shareable real-capture check. The session-level script needs a built dist and a wasm-bindgen
  pkg. [owner] 35 captures: 38.1% right of shown on main, 40.4% with the fix (21 better, 12 worse, p 0.16: modest,
  not significant). A follow-up (POS axes inside the core) did better on those captures and goes through the release
  path on its own.
- **Where.** Branch `fix/rust-colour-projection-sign` 06f93f6; `pr/rust-colour-projection-sign` b527385 (local). In
  the test build: switch `colourProjectionFix`.

Files: [pr.md](pr.md), audit [../../audits/core.md](../../audits/core.md), [lamp.mjs](lamp.mjs).

```
node lamp.mjs <0.14.0 dir> 90 60          # lamp wins: 67
node lamp.mjs packages/rppg-web 90 60     # pulse wins: about 90
```
