/**
 * Small skin patches across the face, per frame, RECORDED ONLY (`recordPulseCheckInputs: { facePatches: true }`).
 *
 * Why: a recording keeps the three box means the check reads (forehead, left cheek, right cheek), so a saved file
 * cannot be re-scored with any other way of reading the face. This keeps, for every frame the check is pushed, the
 * skin-masked colour sums and pixel counts of a fixed 115-patch layout (the layout of the team's sub-region capture,
 * copied unchanged from its capture page, so a file made with this option is scored on the same patches), so a
 * finer reading can be scored offline against a reference sensor on the same seconds.
 *
 * Nothing reads it: no rule, no state, no shown number. With the option off it is never computed (DemoRunner asks
 * `PulseCheck.wantsFacePatches`, false unless a RecordingPulseCheck was built with it).
 *
 * Layout (FACE_PATCH_LAYOUT_ID): 115 patches.
 * - 64 grid cells (family G) in the landmark-percentile box the face boxes use (roiProfile.ts: x 5th..95th, y 3rd..97th
 *   percentile of all landmarks): 24 forehead cells ABOVE the brows (the box's top edge sits at the brows, so the
 *   forehead proper lies at negative y), 8 cells tiling today's forehead box, 16 per cheek enclosing today's cheek
 *   boxes. Each cell is rounded as roiProfile.ts computeFractionalFaceRoiRects rounds, then clipped to the frame.
 * - 51 squares (family L) centred on fixed MediaPipe 478-point mesh landmarks (17 forehead, 34 cheek), each of side
 *   FACE_PATCH_LANDMARK_SIDE times the percentile box HEIGHT (the box's width collapses when the head turns; its
 *   height does not).
 *
 * Per patch, FACE_PATCH_FIELDS: integer sums of R, G and B over the pixels the YCbCr skin mask keeps (the expression
 * of frameSource.ts averageRgbInROIWithSkinMaskStats), how many it kept, and how many the patch held (0 when the patch
 * lies off the frame). Sums, not means, so the file holds every value exactly in fewer characters: a patch's mean on
 * the library's 0..1 scale is sumR / skin / 255, the same arithmetic the library's box mean uses.
 */
import type { Frame } from "./frameSource.js";
/** The layout's name in a recording; a new layout takes a new name. */
export declare const FACE_PATCH_LAYOUT_ID = "lane-subregion-115-v1";
type Frac = readonly [number, number, number, number];
/**
 * Family G, in percentile-box fractions [x0, y0, x1, y1], in this order (harness/main.ts G_FOREHEAD, G_BROW,
 * G_LCHEEK, G_RCHEEK): 24 forehead cells 0.10 x 0.09 above the brows; 8 cells 0.09 x 0.09 tiling today's forehead box
 * [0.32,0.13,0.68,0.30]; 16 cells per cheek, 0.09 x 0.09, enclosing leftCheek [0.16,0.42,0.43,0.70] (image left) and
 * rightCheek [0.57,0.42,0.84,0.70].
 */
export declare const FACE_PATCH_GRID: readonly Frac[];
/** How many cells of FACE_PATCH_GRID each family holds, in order. */
export declare const FACE_PATCH_GRID_FAMILIES: Readonly<{
    forehead: 24;
    brow: 8;
    leftCheek: 16;
    rightCheek: 16;
}>;
/**
 * Family L, the mesh landmarks each square is centred on, in this order (harness/main.ts L_FOREHEAD then L_CHEEK):
 * forehead midline 10, 151, 9 (glabella) and mirrored pairs above the brows, then mirrored cheek pairs.
 */
export declare const FACE_PATCH_LANDMARKS: readonly number[];
/**
 * A landmark square's side as a share of the percentile box height. 0.075 matches a grid cell's area on a frontal face
 * (cell 0.08 w x 0.08 h, with w about 0.85 h, gives a square of side sqrt(0.068 x 0.08) = 0.074 h; harness/main.ts),
 * so both families have comparable pixel counts.
 */
export declare const FACE_PATCH_LANDMARK_SIDE = 0.075;
/** Patches per frame: 64 grid cells then 51 landmark squares. */
export declare const FACE_PATCH_COUNT: number;
/** The numbers kept per patch, in order. */
export declare const FACE_PATCH_FIELDS: readonly ["sumR", "sumG", "sumB", "skin", "n"];
/**
 * One frame's patches. `box`: the percentile box [x0, y0, w, h] in pixels the layout was placed in. `values`:
 * FACE_PATCH_COUNT x FACE_PATCH_FIELDS integers, patch after patch.
 */
export type FacePatches = {
    box: [number, number, number, number];
    values: Uint32Array;
};
/**
 * The layout's patches on this frame, or null when the frame carries no mesh of at least the layout's points.
 * The percentile box is roiProfile.ts percentileBounds (the same clamp, sort and pick), computed in typed arrays.
 */
export declare function facePatchesFromFrame(frame: Frame, landmarks: readonly {
    x: number;
    y: number;
}[] | null | undefined): FacePatches | null;
/**
 * The forehead pool's patches (foreheadPool.ts): grid cells 0 to 31 (24 above the brows, 8 tiling today's forehead box)
 * and the first 17 landmark squares (forehead), in that order, as means (0..255) with skin and pixel counts. Computes
 * only these 49 patches, placed and measured exactly as facePatchesFromFrame places and measures them.
 */
export declare const FOREHEAD_POOL_GRID = 32;
export declare const FOREHEAD_POOL_LANDMARKS = 17;
export declare const FOREHEAD_POOL_SIZE: number;
export declare function foreheadPoolFromFrame(frame: Frame, landmarks: readonly {
    x: number;
    y: number;
}[] | null | undefined): {
    mean: Float64Array;
    skin: Float64Array;
    n: Float64Array;
} | null;
export {};
//# sourceMappingURL=facePatches.d.ts.map