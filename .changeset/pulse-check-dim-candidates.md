---
"@elata-biosciences/rppg-web": patch
---

Four pulse-check rules for dim light, each OFF unless set to true in `pulseCheckRules`, so today's behaviour is unchanged: `followerMedian` (the rate shown is the median of the last 3 follower values), `reproveOnDrift` (a held rate more than 6 bpm from its last fresh proof needs a fresh proof), `tooDark` (no rate while the newest 4 windows' mean SNR is below -4 dB, the level a face with no pulse reaches; `getPulseCheck().tooDark` says so), and `anchorDrift` (a run of shown rates ends, and the evidence starts over, once it moves more than 6 bpm from where it was first proven). Their settings were fixed before any chest-strap data existed; a chest-strap study decides whether any goes on. `getPulseCheck()` also shows `followerBpm`, `heldBpm`, `provenBpm` and `anchorBpm` for diagnosis.
