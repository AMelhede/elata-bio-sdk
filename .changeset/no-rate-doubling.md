---
"@elata-biosciences/rppg-web": patch
---

`estimateDominantBpm`, the spectral estimate in `analyzePulseWindow`, no longer replaces the strongest rate with twice that rate; the rule fired on normal resting heart rates and doubled correct readings (for example 65 to 130). The peak and beat-timing (HRV) estimates it seeds and `RppgProcessor`'s resolved and final rates change with it.
