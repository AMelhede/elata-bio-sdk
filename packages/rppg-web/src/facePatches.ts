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
import type { Frame } from "./frameSource";

/** The layout's name in a recording; a new layout takes a new name. */
export const FACE_PATCH_LAYOUT_ID = "lane-subregion-115-v1";

type Frac = readonly [number, number, number, number];
const grid = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number): Frac[] => {
	const out: Frac[] = [];
	for (let j = 0; j < ny; j++)
		for (let i = 0; i < nx; i++)
			out.push([x0 + ((x1 - x0) * i) / nx, y0 + ((y1 - y0) * j) / ny, x0 + ((x1 - x0) * (i + 1)) / nx, y0 + ((y1 - y0) * (j + 1)) / ny]);
	return out;
};

/**
 * Family G, in percentile-box fractions [x0, y0, x1, y1], in this order (harness/main.ts G_FOREHEAD, G_BROW,
 * G_LCHEEK, G_RCHEEK): 24 forehead cells 0.10 x 0.09 above the brows; 8 cells 0.09 x 0.09 tiling today's forehead box
 * [0.32,0.13,0.68,0.30]; 16 cells per cheek, 0.09 x 0.09, enclosing leftCheek [0.16,0.42,0.43,0.70] (image left) and
 * rightCheek [0.57,0.42,0.84,0.70].
 */
export const FACE_PATCH_GRID: readonly Frac[] = Object.freeze([
	...grid(0.2, -0.28, 0.8, 0.08, 6, 4),
	...grid(0.32, 0.12, 0.68, 0.3, 4, 2),
	...grid(0.08, 0.38, 0.44, 0.74, 4, 4),
	...grid(0.56, 0.38, 0.92, 0.74, 4, 4),
]);
/** How many cells of FACE_PATCH_GRID each family holds, in order. */
export const FACE_PATCH_GRID_FAMILIES = Object.freeze({ forehead: 24, brow: 8, leftCheek: 16, rightCheek: 16 });
/**
 * Family L, the mesh landmarks each square is centred on, in this order (harness/main.ts L_FOREHEAD then L_CHEEK):
 * forehead midline 10, 151, 9 (glabella) and mirrored pairs above the brows, then mirrored cheek pairs.
 */
export const FACE_PATCH_LANDMARKS: readonly number[] = Object.freeze([
	10, 151, 9, 67, 297, 69, 299, 104, 333, 108, 337, 109, 338, 103, 332, 54, 284,
	50, 280, 101, 330, 118, 347, 117, 346, 123, 352, 147, 376, 187, 411, 205, 425, 36, 266, 116, 345, 111, 340, 100, 329,
	126, 355, 142, 371, 203, 423, 206, 426, 207, 427,
]);
/**
 * A landmark square's side as a share of the percentile box height. 0.075 matches a grid cell's area on a frontal face
 * (cell 0.08 w x 0.08 h, with w about 0.85 h, gives a square of side sqrt(0.068 x 0.08) = 0.074 h; harness/main.ts),
 * so both families have comparable pixel counts.
 */
export const FACE_PATCH_LANDMARK_SIDE = 0.075;
/** Patches per frame: 64 grid cells then 51 landmark squares. */
export const FACE_PATCH_COUNT = FACE_PATCH_GRID.length + FACE_PATCH_LANDMARKS.length;
/** The numbers kept per patch, in order. */
export const FACE_PATCH_FIELDS = Object.freeze(["sumR", "sumG", "sumB", "skin", "n"] as const);
const PF = FACE_PATCH_FIELDS.length;
/** The highest mesh index the layout reads: a mesh with fewer points gives no patches. */
const MAX_LANDMARK = Math.max(...FACE_PATCH_LANDMARKS);

/**
 * One frame's patches. `box`: the percentile box [x0, y0, w, h] in pixels the layout was placed in. `values`:
 * FACE_PATCH_COUNT x FACE_PATCH_FIELDS integers, patch after patch.
 */
export type FacePatches = { box: [number, number, number, number]; values: Uint32Array };

/** Reused sort buffers: the percentile box sorts every landmark twice a frame, with no allocation. */
let xsBuf = new Float64Array(0);
let ysBuf = new Float64Array(0);

/**
 * The layout's patches on this frame, or null when the frame carries no mesh of at least the layout's points.
 * The percentile box is roiProfile.ts percentileBounds (the same clamp, sort and pick), computed in typed arrays.
 */
export function facePatchesFromFrame(
	frame: Frame,
	landmarks: readonly { x: number; y: number }[] | null | undefined,
): FacePatches | null {
	const W = frame.width;
	const H = frame.height;
	const data = frame.data;
	if (!landmarks || landmarks.length <= MAX_LANDMARK || W <= 0 || H <= 0) return null;
	const m = landmarks.length;
	if (xsBuf.length !== m) {
		xsBuf = new Float64Array(m);
		ysBuf = new Float64Array(m);
	}
	for (let i = 0; i < m; i++) {
		const p = landmarks[i];
		xsBuf[i] = Math.min(1, Math.max(0, p.x));
		ysBuf[i] = Math.min(1, Math.max(0, p.y));
	}
	xsBuf.sort();
	ysBuf.sort();
	const pick = (v: Float64Array, q: number) => v[Math.min(v.length - 1, Math.max(0, Math.floor((v.length - 1) * q)))];
	const bx0 = pick(xsBuf, 0.05) * W;
	const bx1 = pick(xsBuf, 0.95) * W;
	const by0 = pick(ysBuf, 0.03) * H;
	const by1 = pick(ysBuf, 0.97) * H;
	const bw = Math.max(1, bx1 - bx0);
	const bh = Math.max(1, by1 - by0);
	const values = new Uint32Array(FACE_PATCH_COUNT * PF);
	const patch = (px0: number, py0: number, px1: number, py1: number, o: number) => {
		const x0 = Math.max(0, Math.min(W, px0));
		const x1 = Math.max(0, Math.min(W, px1));
		const y0 = Math.max(0, Math.min(H, py0));
		const y1 = Math.max(0, Math.min(H, py1));
		let sR = 0, sG = 0, sB = 0, sk = 0, n = 0;
		for (let row = y0; row < y1; row++) {
			let i = (row * W + x0) * 4;
			for (let col = x0; col < x1; col++, i += 4) {
				const r = data[i], g = data[i + 1], b = data[i + 2];
				n++;
				const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
				const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
				if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) {
					sR += r;
					sG += g;
					sB += b;
					sk++;
				}
			}
		}
		values[o] = sR;
		values[o + 1] = sG;
		values[o + 2] = sB;
		values[o + 3] = sk;
		values[o + 4] = n;
	};
	let o = 0;
	for (const [fx0, fy0, fx1, fy1] of FACE_PATCH_GRID) {
		const x0 = Math.round(bx0 + bw * fx0), y0 = Math.round(by0 + bh * fy0);
		const x1 = Math.max(x0 + 1, Math.round(bx0 + bw * fx1)), y1 = Math.max(y0 + 1, Math.round(by0 + bh * fy1));
		patch(x0, y0, x1, y1, o);
		o += PF;
	}
	const half = (FACE_PATCH_LANDMARK_SIDE * bh) / 2;
	for (const k of FACE_PATCH_LANDMARKS) {
		const p = landmarks[k];
		const cx = p.x * W, cy = p.y * H;
		const x0 = Math.round(cx - half), y0 = Math.round(cy - half);
		patch(x0, y0, Math.max(x0 + 1, Math.round(cx + half)), Math.max(y0 + 1, Math.round(cy + half)), o);
		o += PF;
	}
	return { box: [bx0, by0, bw, bh], values };
}

/**
 * The forehead pool's patches (foreheadPool.ts): grid cells 0 to 31 (24 above the brows, 8 tiling today's forehead box)
 * and the first 17 landmark squares (forehead), in that order, as means (0..255) with skin and pixel counts. Computes
 * only these 49 patches, placed and measured exactly as facePatchesFromFrame places and measures them.
 */
export const FOREHEAD_POOL_GRID = 32;
export const FOREHEAD_POOL_LANDMARKS = 17;
export const FOREHEAD_POOL_SIZE = FOREHEAD_POOL_GRID + FOREHEAD_POOL_LANDMARKS;
export function foreheadPoolFromFrame(
	frame: Frame,
	landmarks: readonly { x: number; y: number }[] | null | undefined,
): { mean: Float64Array; skin: Float64Array; n: Float64Array } | null {
	const W = frame.width, H = frame.height, data = frame.data;
	if (!landmarks || landmarks.length <= MAX_LANDMARK || W <= 0 || H <= 0) return null;
	const xs = Float64Array.from(landmarks, (p) => Math.min(1, Math.max(0, p.x))).sort();
	const ys = Float64Array.from(landmarks, (p) => Math.min(1, Math.max(0, p.y))).sort();
	const pick = (v: Float64Array, q: number) => v[Math.min(v.length - 1, Math.max(0, Math.floor((v.length - 1) * q)))];
	const bx0 = pick(xs, 0.05) * W, bx1 = pick(xs, 0.95) * W, by0 = pick(ys, 0.03) * H, by1 = pick(ys, 0.97) * H;
	const bw = Math.max(1, bx1 - bx0), bh = Math.max(1, by1 - by0);
	const mean = new Float64Array(FOREHEAD_POOL_SIZE * 3), skin = new Float64Array(FOREHEAD_POOL_SIZE), n = new Float64Array(FOREHEAD_POOL_SIZE);
	const patch = (px0: number, py0: number, px1: number, py1: number, k: number) => {
		const x0 = Math.max(0, Math.min(W, px0)), x1 = Math.max(0, Math.min(W, px1));
		const y0 = Math.max(0, Math.min(H, py0)), y1 = Math.max(0, Math.min(H, py1));
		let sR = 0, sG = 0, sB = 0, sk = 0, cnt = 0;
		for (let row = y0; row < y1; row++) {
			let i = (row * W + x0) * 4;
			for (let col = x0; col < x1; col++, i += 4) {
				const r = data[i], g = data[i + 1], b = data[i + 2];
				cnt++;
				const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
				const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
				if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) { sR += r; sG += g; sB += b; sk++; }
			}
		}
		mean[3 * k] = sk ? sR / sk : NaN; mean[3 * k + 1] = sk ? sG / sk : NaN; mean[3 * k + 2] = sk ? sB / sk : NaN;
		skin[k] = sk; n[k] = cnt;
	};
	for (let k = 0; k < FOREHEAD_POOL_GRID; k++) {
		const [fx0, fy0, fx1, fy1] = FACE_PATCH_GRID[k];
		const x0 = Math.round(bx0 + bw * fx0), y0 = Math.round(by0 + bh * fy0);
		patch(x0, y0, Math.max(x0 + 1, Math.round(bx0 + bw * fx1)), Math.max(y0 + 1, Math.round(by0 + bh * fy1)), k);
	}
	const half = (FACE_PATCH_LANDMARK_SIDE * bh) / 2;
	for (let j = 0; j < FOREHEAD_POOL_LANDMARKS; j++) {
		const p = landmarks[FACE_PATCH_LANDMARKS[j]];
		const cx = p.x * W, cy = p.y * H;
		const x0 = Math.round(cx - half), y0 = Math.round(cy - half);
		patch(x0, y0, Math.max(x0 + 1, Math.round(cx + half)), Math.max(y0 + 1, Math.round(cy + half)), FOREHEAD_POOL_GRID + j);
	}
	return { mean, skin, n };
}
