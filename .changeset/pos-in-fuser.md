---
"@elata-biosciences/rppg-web": minor
---

The multi-region fuser (`MultiRoiRppgFuser`, used by `createRppgSession` in
`face_mesh` mode) now projects each region with POS (Wang et al. 2017) instead of
CHROM by default, and exports the new `PosPulseModel`. `ChromPulseModel` keeps
the window mean of its two axes, which is 1 for each, so its output carries a
term (1 - alpha). Alpha is re-estimated on every frame, so its frame-to-frame
change reached the fused pulse at full size, and sensor noise alone could put
the fused pulse's peak tens of bpm away from the true rate. POS's axes each sum
to zero, so the fused pulse no longer carries that term. The new
`fusionProjection` option (`"pos"` or `"chrom"`, on `createRppgSession`,
`DemoRunner` and the fuser's constructor) keeps the previous output reachable
with `"chrom"`. `ChromPulseModel` itself, and the non-fused processor path that
uses it, are unchanged.
