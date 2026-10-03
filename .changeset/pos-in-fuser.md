---
"@elata-biosciences/rppg-web": minor
---

The multi-region fuser projects each region with POS (Wang et al. 2017) instead of CHROM by default. CHROM needs long windows (about 10 s) to separate pulse from light changes; the fuser works on short ones, where POS is the method built for it. `fusionProjection: "chrom"` keeps the old behaviour.
