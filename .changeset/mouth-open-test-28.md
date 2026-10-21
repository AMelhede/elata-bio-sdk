---
"@elata-biosciences/rppg-web": patch
---

0.15.0-test.28: the head the pulse check is handed now also carries `mouthOpen`, the inner-lip gap (face mesh 13 to
14) as a share of the face's width, and an input recording keeps it as the head's fourth number. Recorded only: no
rule of the pulse check reads it, so every rate and every withheld second is unchanged (752 of 752 tests, the
recording round trip and replay as before). An app uses it to confirm a talking step; a head without the lips keeps
three numbers, as before.
