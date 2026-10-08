---
"@elata-biosciences/rppg-web": patch
---

The head rule's constants (`HEAD_MIN_SNR_DB`, `HEAD_MIN_SIZE` and the gap bar) no longer carry measurements of recorded people in their comments, which ship in `dist/pulseCheck.js` and `dist/pulseCheck.d.ts`: they say the value was chosen by measurement on recorded captures against a reference pulse, as every other constant does. The release check now refuses a "real-pulse window", and a real pulse, head, face or person said to stand at some dB or per cent in one sentence, anywhere in what ships. No change to what any rule decides.
