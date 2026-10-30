/**
 * How much light the screen should put on the face, decided from the face itself (session option `light`).
 *
 * A watch carries its own light; a camera reading has only the room and the screen. The screen is the one light an app
 * controls (the phone's display as a controllable light source doubled camera pulse-oximetry signal quality: Holz and
 * Ofek, EMBC 2018, doi 10.1109/EMBC.2018.8513286), and it fails two ways: too little leaves the face dim, too much burns
 * the face out because the camera meters the whole frame, a dark room behind the face (auto-exposure metered on skin
 * instead fixes exactly this: Yi, Yu, Zhu and Wang, EMBC 2024, doi 10.1109/EMBC53108.2024.10781984). A burnt-out face
 * cannot be recovered by any processing afterwards (PixExpo, arXiv 2609.36607).
 *
 * The SDK decides a level in linear light, 0, 1 or 0.5; the app renders what it can (a white page, a fill overlay, a
 * native shell's full brightness) and reports what it rendered. An app that cannot light the screen gets the same
 * reading with fewer numbers in a dim room. Pure, so each rule is testable without a camera.
 */

export type LightLevel = 0 | 0.5 | 1;

export interface FaceLight {
	/**
	 * Rec.709 luma, 0..1: of the face regions' skin-masked mean colour (the same means the pulse check reads), or with
	 * no face found of the plain mean over CENTRE_BOX.
	 */
	readonly luma: number;
	/** Share of the face regions' pixels, skin or not, with red at or above RED_CLIP_LEVEL. */
	readonly redClip: number;
	/** Where it was read: the face regions, or the centre of the picture while no face is found. */
	readonly source: "face" | "centre";
}

export interface LightState {
	/** The level the app is asked to render. */
	readonly level: LightLevel;
	/** When the current unbroken run of dim frames began, or null. */
	readonly darkSince: number | null;
	/** When the current unbroken run of frames at full light that burnt the face out began, or null. */
	readonly clipSince: number | null;
	/** When the current unbroken run of frames with a face but too faint a pulse to show began, or null. */
	readonly weakSince?: number | null;
}

export const LIGHT_START: LightState = { level: 0, darkSince: null, clipSince: null };

/**
 * Below this the face is dim. An app's exposure target of 0.38, measured on real captures as the level under which a
 * face is genuinely underlit, is on a fixed centre box of the picture; this module reads the pulse check's own face
 * regions, skin-masked, which read brighter. On 80 recorded sessions the sessions' medians relate as
 * region = 0.170 + 0.831 x box (r 0.83), 0.486 at the box's 0.38, and 0.47 sorts 76 of 80 sessions the same way the
 * box's 0.38 does (only 8 of them under it, so the bar is re-derived once recordings carrying both values arrive: the
 * recording keeps this luma).
 */
export const LIGHT_DIM_LUMA = 0.47;

/**
 * Where a centred face sits while none is found yet: the middle 30% of the width and 50% of the height. A face too dark
 * to be found is exactly the case the light is for, so the level cannot wait for a face. The bar there is the app
 * measure itself, 0.38, read on this same box.
 */
export const CENTRE_BOX = { x0: 0.35, x1: 0.65, y0: 0.25, y1: 0.75 } as const;
export const LIGHT_DIM_LUMA_CENTRE = 0.38;

/**
 * How long a face must read dim, or burnt out, before the level steps: a camera starting, or
 * answering the screen's new light, settles its exposure in about 1.6 s; 2 s clears that.
 */
export const LIGHT_LATCH_MS = 2000;

/**
 * How long a face in view may show no number, once the check has a full window, before the light comes on although the
 * face does not read dim: the light is for the pulse, so the pulse's own strength is the measure that decides, the way
 * a phone's front flash fires on what its camera measures. On a recorded laptop session after a workout the face
 * read 0.49, just over the dim bar, the check's windows read 90 to 94 against a ring's 89 to 96 at -2 to -8 dB, and the
 * light never came on: 6 seconds with a number in 128. The same laptop with the light from the start showed 38 seconds in 94
 * against 11 without. 10 s: five of the check's agreeing windows' worth, so a number about to arrive is not lit over.
 */
export const LIGHT_WEAK_MS = 10_000;

/** A red level at or above this counts as clipped (255 is full scale). */
export const RED_CLIP_LEVEL = 250;

/**
 * Red clipped on this share of the face at full light means the light is burning it out. On 105 recorded sessions,
 * seconds after the check first saw a signal: a number on 20 to 29% of seconds below 0.3 clipped, 13.6% at 0.3 to 0.5
 * (381 seconds, 19 sessions), 2.0% at 0.5 or more (199 seconds, 10 sessions). A laptop webcam in a dim room at night:
 * full light, 0.56 to 0.72 clipped, no number in 38 s; the same room unlit, 0.25 to 0.44 and 18 seconds in 74.
 */
export const LIGHT_CLIP_MAX = 0.5;

/**
 * The next level. Latched both ways, 0 to 1 once and 1 to 0.5 once, never back: a lamp that lit the face then read the
 * brighter face, switched itself off and the reading died (an app's dark capture, 2026-09-24), and the pulse check
 * withholds a pulse when the light on the face keeps stepping (rule screenLight). Burnout is judged only on full light
 * the app says it rendered (`applied`), so an app that cannot light is never asked to light less. `weak`: a face is in
 * view and the check, past its first window, shows no number; held LIGHT_WEAK_MS it lights a face that is not dim.
 */
export function lightAfter(prev: LightState, face: FaceLight | null, applied: LightLevel, now: number, weak = false): LightState {
	if (prev.level === 0.5 || face == null || !Number.isFinite(face.luma) || !Number.isFinite(face.redClip)) return prev;
	if (prev.level === 0) {
		// A faint pulse on a face that does not read dim lights it too, after LIGHT_WEAK_MS.
		const weakSince = weak ? (prev.weakSince ?? now) : null;
		if (weakSince != null && now - weakSince >= LIGHT_WEAK_MS) return { level: 1, darkSince: prev.darkSince, clipSince: null, weakSince };
		if (face.luma >= (face.source === "centre" ? LIGHT_DIM_LUMA_CENTRE : LIGHT_DIM_LUMA)) return weakSince == null ? LIGHT_START : { ...LIGHT_START, weakSince };
		const darkSince = prev.darkSince ?? now;
		return now - darkSince >= LIGHT_LATCH_MS ? { level: 1, darkSince, clipSince: null, weakSince } : { level: 0, darkSince, clipSince: null, weakSince };
	}
	if (applied !== 1 || face.redClip < LIGHT_CLIP_MAX) return { ...prev, clipSince: null };
	const clipSince = prev.clipSince ?? now;
	return now - clipSince >= LIGHT_LATCH_MS ? { ...prev, level: 0.5, clipSince } : { ...prev, clipSince };
}

/** Rec.709 luma of a 0..1 colour. */
export function lumaOfRgb(c: { r: number; g: number; b: number }): number {
	return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The face's light from one RGBA frame: luma from the regions' skin-masked means (already computed for the pulse check,
 * passed in), red clip from every pixel inside the region boxes, every second pixel each way (a burnt pixel is white and
 * fails the skin mask, so the mask must not decide which pixels count). Null with no region or no pixel.
 */
export function faceLightFromFrame(
	data: ArrayLike<number>,
	width: number,
	boxes: readonly { x: number; y: number; w: number; h: number }[],
	means: readonly { r: number; g: number; b: number }[],
): FaceLight | null {
	if (!boxes.length || !means.length) return null;
	let n = 0;
	let clipped = 0;
	for (const b of boxes) {
		const x0 = Math.max(0, Math.floor(b.x));
		const y0 = Math.max(0, Math.floor(b.y));
		const x1 = Math.min(width, Math.floor(b.x + b.w));
		const y1 = Math.floor(b.y + b.h);
		for (let y = y0; y < y1; y += 2) {
			for (let x = x0; x < x1; x += 2) {
				const i = (y * width + x) * 4;
				if (i + 2 >= data.length) continue;
				n++;
				if (data[i] >= RED_CLIP_LEVEL) clipped++;
			}
		}
	}
	if (n === 0) return null;
	const luma = means.reduce((s, c) => s + lumaOfRgb(c), 0) / means.length;
	return { luma, redClip: clipped / n, source: "face" };
}

/** The light from CENTRE_BOX of one RGBA frame, every second pixel each way, for frames with no face found. */
export function centreLightFromFrame(data: ArrayLike<number>, width: number, height: number): FaceLight | null {
	const x0 = Math.floor(width * CENTRE_BOX.x0);
	const x1 = Math.ceil(width * CENTRE_BOX.x1);
	const y0 = Math.floor(height * CENTRE_BOX.y0);
	const y1 = Math.ceil(height * CENTRE_BOX.y1);
	let n = 0;
	let clipped = 0;
	let luma = 0;
	for (let y = y0; y < y1; y += 2) {
		for (let x = x0; x < x1; x += 2) {
			const i = (y * width + x) * 4;
			if (i + 2 >= data.length) continue;
			n++;
			luma += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
			if (data[i] >= RED_CLIP_LEVEL) clipped++;
		}
	}
	return n === 0 ? null : { luma: luma / n, redClip: clipped / n, source: "centre" };
}
