import type { PulseCheckCause } from "./pulseCheck";

/** Rec.709 luma of an RGB pixel, 0..1 (channel inputs 0..255). */
export function lumaOf(r: number, g: number, b: number): number {
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Face brightness a camera aims for (a face is darker than the frame mean); under it, more screen light helps. */
export const LUMA_TARGET = 0.38;

/** The lowest face brightness at which a pulse was seen to track in a graded light sweep; under it, light first. */
export const LUMA_FLOOR = 0.23;

/** How much brighter the room must read than the face before "turn to face the light" is the advice. */
export const BACKLIT_MIN_GAP = 0.05;

/** Centre weighting for metering a frame with no face box. */
export function centerWeight(u: number, v: number): number {
	const dx = (u - 0.5) * 2;
	const dy = (v - 0.5) * 2;
	const r = Math.min(1, Math.hypot(dx, dy) / Math.SQRT2);
	return 0.05 + 0.95 * (1 - r) ** 3;
}

/** Where a centred face sits in the picture: the middle 30% of the width and 50% of the height. */
export const FACE_BOX = { x0: 0.35, x1: 0.65, y0: 0.25, y1: 0.75 } as const;

/** Face, centre-weighted and whole-frame brightness of a small square frame (RGBA bytes), or null without pixels. */
export function meter(
	data: ArrayLike<number>,
	size: number,
): { face: number; centre: number; room: number } | null {
	let weighted = 0;
	let total = 0;
	let plain = 0;
	let count = 0;
	let box = 0;
	let boxCount = 0;
	for (let i = 0; i + 3 < data.length; i += 4) {
		const p = i / 4;
		const u = ((p % size) + 0.5) / size;
		const v = (Math.floor(p / size) + 0.5) / size;
		const w = centerWeight(u, v);
		const l = lumaOf(data[i], data[i + 1], data[i + 2]);
		weighted += w * l;
		total += w;
		plain += l;
		count++;
		if (
			u >= FACE_BOX.x0 &&
			u <= FACE_BOX.x1 &&
			v >= FACE_BOX.y0 &&
			v <= FACE_BOX.y1
		) {
			box += l;
			boxCount++;
		}
	}
	if (count === 0 || total <= 0 || boxCount === 0) return null;
	return {
		face: box / boxCount,
		centre: weighted / total,
		room: plain / count,
	};
}

/** One instruction per state. */
export type Advice =
	| "no_camera"
	| "no_face"
	| "backlit"
	| "night_light"
	| "more_light"
	| "brighter_screen"
	| "flicker"
	| "moving"
	| "still"
	| "almost"
	| "stalled";

/** The words for each instruction: what to do, in a few plain words. */
export const ADVICE_TEXT: Record<Advice, string> = {
	no_camera: "Starting camera",
	no_face: "Center your face",
	backlit: "Light is behind you. Turn to face it",
	night_light: "Turn off night light",
	brighter_screen: "Turn screen brightness all the way up",
	more_light: "Add some light in front of you",
	flicker: "A light is flickering. Use a steady lamp or daylight",
	moving: "Hold still",
	still: "Hold still",
	almost: "Hold still. Almost there",
	stalled: "Still measuring. Move closer to the light",
};

/** True when the instruction asks the person to do something; only these are shown (progress is carried by the display). */
export function needsYou(a: Advice): boolean {
	return (
		a === "no_face" ||
		a === "backlit" ||
		a === "night_light" ||
		a === "brighter_screen" ||
		a === "more_light" ||
		a === "flicker" ||
		a === "stalled" ||
		a === "moving"
	);
}

/** True when the advice asks the person to change something before a pulse can be read. */
export function isBlocking(a: Advice): boolean {
	return (
		a === "no_camera" ||
		a === "no_face" ||
		a === "backlit" ||
		a === "night_light"
	);
}

/** What one moment of guidance is decided from. */
export interface CoachInput {
	readonly light: { face: number; centre: number; room: number } | null;
	readonly faceFound: boolean;
	readonly lampOn: boolean;
	readonly hasNumber: boolean;
	readonly searchingMs?: number;
	readonly movement?: number | null;
	readonly warmth?: number | null;
	readonly blueWarmth?: number | null;
	readonly cause?: GuideCause | null;
	readonly colourDamaged?: boolean;
	readonly starved?: boolean;
	readonly exposureKnown?: boolean;
}

/** A camera starved of light: its exposure (Chrome exposureTime, 100 microsecond units) is a frame long at 30 fps or more. */
export const EXPOSURE_STARVED = 333;
export const cameraStarved = (
	exposureTime: number | null | undefined,
): boolean =>
	exposureTime != null &&
	Number.isFinite(exposureTime) &&
	exposureTime >= EXPOSURE_STARVED;

/** The check's own first blocking cause (pulseCheckCause), or headMotion from an app's own movement check. */
export type GuideCause = PulseCheckCause | "headMotion";

/** Below this green over red on the face, the light on it is too orange to read a pulse (a warm screen filter or lamp). */
export const WARM_MAX = 0.33;

const WARMTH_WINDOW_MS = 2000;

/** Green over red of the check's own face regions over the last WARMTH_WINDOW_MS. */
export function warmthOf(
	events: readonly (readonly unknown[])[],
): number | null {
	let r = 0,
		g = 0,
		last = -Infinity;
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i];
		if (e[0] !== "f") continue;
		const t = e[1] as number;
		if (last === -Infinity) last = t;
		if (t < last - WARMTH_WINDOW_MS) break;
		for (const reg of e[2] as readonly (readonly number[])[]) {
			r += reg[0];
			g += reg[1];
		}
	}
	return r > 0 ? g / r : null;
}

/** Blue over red of the face regions: a warm filter cuts blue more than green, a dark picture does not. */
export function blueWarmthOf(
	events: readonly (readonly unknown[])[],
): number | null {
	let r = 0,
		b = 0,
		last = -Infinity;
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i];
		if (e[0] !== "f") continue;
		const t = e[1] as number;
		if (last === -Infinity) last = t;
		if (t < last - WARMTH_WINDOW_MS) break;
		for (const reg of e[2] as readonly (readonly number[])[]) {
			r += reg[0];
			b += reg[2];
		}
	}
	return r > 0 ? b / r : null;
}

/** Head movement is judged over the last 8 s, as the pulse check asks its newest 8 s to carry the rate. */
export const MOVE_WINDOW_MS = 8000;

/** Head movement (median frame-to-frame centre shift over face width) above which "hold still" is the fix. */
export const MOVE_MAX = 0.07;

const MOVE_MIN_ROWS = 60;

const spread = (xs: number[]) => {
	const m = xs.reduce((a, b) => a + b, 0) / xs.length;
	return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/** Head movement over MOVE_WINDOW_MS from head rows, or null when there are too few to judge. */
export function movementOf(
	rows: readonly { t_ms: number; x: number; y: number; w: number }[],
	endMs: number,
): number | null {
	const win = rows.filter(
		(r) => r.t_ms > endMs - MOVE_WINDOW_MS && r.t_ms <= endMs && r.w > 0,
	);
	if (win.length < MOVE_MIN_ROWS) return null;
	const ws = win.map((r) => r.w).sort((a, b) => a - b);
	const w = ws[ws.length >> 1];
	return (
		(spread(win.map((r) => r.x)) +
			spread(win.map((r) => r.y)) +
			spread(win.map((r) => r.w))) /
		w
	);
}

/** How long a face may be in view with no number before the stall line replaces silence. */
export const STALL_MS = 42_000;

/** The one instruction for this moment, in the order a person must fix things: a picture, a face, then light. */
export function adviceFor(s: CoachInput): Advice {
	if (s.hasNumber) return "still";
	if (!s.light) return "no_camera";
	const { face, centre, room } = s.light;
	if (
		!s.faceFound &&
		centre < LUMA_TARGET &&
		room >= LUMA_TARGET &&
		room - centre >= BACKLIT_MIN_GAP
	)
		return "backlit";
	if (!s.faceFound) return "no_face";
	if (
		s.warmth != null &&
		s.warmth < WARM_MAX &&
		s.light.face >= LUMA_FLOOR &&
		!(s.blueWarmth != null && s.blueWarmth >= s.warmth)
	)
		return "night_light";
	if (s.cause) {
		const a = adviceForCause(
			s.cause,
			face,
			s.lampOn,
			s.movement ?? null,
			s.colourDamaged === true || s.starved === true,
		);
		if (
			a === "still" &&
			s.exposureKnown === false &&
			(s.cause === "weakSignal" || s.cause === "noRate") &&
			(s.searchingMs ?? 0) >= STALL_MS
		)
			return "stalled";
		return a;
	}
	if (face < LUMA_FLOOR) return s.lampOn ? "more_light" : "brighter_screen";
	if (s.movement != null && s.movement > MOVE_MAX) return "moving";
	if (s.lampOn && face < LUMA_TARGET) return "brighter_screen";
	return (s.searchingMs ?? 0) >= STALL_MS ? "stalled" : "still";
}

function adviceForCause(
	cause: GuideCause,
	face: number,
	lampOn: boolean,
	movement: number | null,
	colourDamaged: boolean,
): Advice {
	switch (cause) {
		case "collecting":
			return "still";
		case "shown":
			return "almost";
		case "noFace":
			return "no_face";
		case "lightFlicker":
			return "flicker";
		case "headMotion":
			return "moving";
		case "noRate":
		case "weakSignal":
			if (face < LUMA_FLOOR) return lampOn ? "more_light" : "brighter_screen";
			if (face < LUMA_TARGET) return "brighter_screen";
			if (colourDamaged) return "more_light";
			return movement != null && movement > MOVE_MAX ? "moving" : "still";
		case "agreeing":
		case "waitingForBlink":
			return movement != null && movement > MOVE_MAX ? "moving" : "almost";
	}
}

/** A new instruction shows once it has held this long; a number on screen shows "hold still" at once. */
export const ADVICE_HOLD_MS = 4000;

export interface Shown {
	readonly advice: Advice;
	readonly pending: Advice | null;
	readonly since: number;
}

/** The instruction shown after the hold, given the raw one and whether a number is on screen. */
export function shownAfter(
	prev: Shown,
	raw: Advice,
	now: number,
	numberOnScreen: boolean,
): Shown {
	if (numberOnScreen) return { advice: "still", pending: null, since: now };
	if (raw === prev.advice)
		return { advice: prev.advice, pending: null, since: now };
	if (raw !== prev.pending)
		return { advice: prev.advice, pending: raw, since: now };
	return now - prev.since >= ADVICE_HOLD_MS
		? { advice: raw, pending: null, since: now }
		: prev;
}

/**
 * The instruction an app shows, one call per read: the advice for this moment, held by shownAfter, and its text only
 * when the person must do something and no number is on screen. As PulseDisplay decides the number, this decides the line.
 */
export class PulseGuide {
	private shown: Shown = { advice: "no_camera", pending: null, since: 0 };

	next(
		nowMs: number,
		input: Omit<CoachInput, "hasNumber">,
		numberOnScreen: boolean,
	): { raw: Advice; advice: Advice; text: string | null } {
		const raw = adviceFor({ ...input, hasNumber: numberOnScreen });
		this.shown = shownAfter(this.shown, raw, nowMs, numberOnScreen);
		const advice = this.shown.advice;
		return {
			raw,
			advice,
			text: needsYou(advice) && !numberOnScreen ? ADVICE_TEXT[advice] : null,
		};
	}

	reset(): void {
		this.shown = { advice: "no_camera", pending: null, since: 0 };
	}
}
