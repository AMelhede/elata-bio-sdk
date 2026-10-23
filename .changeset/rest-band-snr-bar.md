---
"@elata-biosciences/rppg-web": patch
---

Rule `restBand` (still off unless set to true): a line from 52 to 57 a minute that two of the three regions carry now also needs an SNR of at least -2 dB (`OWN_PULSE_REST_BAND_MIN_SNR_DB`), where the usual bar is -3. Without it the rule let no-pulse video show invented seconds in that band; with it, a pre-registered test on people and no-pulse video it was not tuned on added no invented and no wrong second. With the rule off nothing changes.
