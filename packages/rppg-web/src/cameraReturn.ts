/**
 * Back on the page, a camera the browser stopped while it was hidden (or never handed over) is started again, the way a
 * video call app's camera comes back: `onEnded` runs when the page becomes visible and the track is gone or ended. Pair
 * it with `session.getPulseCheckResume()` handed to the new session as `pulseCheckResume`, so the same heart shows again
 * within seconds. Returns the function that stops watching.
 */
type VisibilityDoc = Pick<
	Document,
	"addEventListener" | "removeEventListener" | "visibilityState"
>;

/**
 * With `framesSeen`, a camera that reports itself live on return but sends no frame within `stallMs` is started again
 * too: a browser on a phone can unmute the track yet never hand the page another frame. Recorded returns resume within
 * a fraction of a second, the slowest within a few seconds; the default is about twice that slowest return.
 */
export const CAMERA_RETURN_STALL_MS = 6000;

export function watchCameraReturn(
	track: () => Pick<MediaStreamTrack, "readyState"> | null | undefined,
	onEnded: () => void,
	doc: VisibilityDoc = document,
	opts: {
		framesSeen?: () => number;
		stallMs?: number;
		setTimer?: (f: () => void, ms: number) => unknown;
		clearTimer?: (h: unknown) => void;
	} = {},
): () => void {
	const setTimer = opts.setTimer ?? ((f: () => void, ms: number) => setTimeout(f, ms));
	const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
	let pending: unknown = null;
	const onVisible = () => {
		if (pending != null) {
			clearTimer(pending);
			pending = null;
		}
		if (doc.visibilityState !== "visible") return;
		const t = track();
		if (!t || t.readyState === "ended") {
			onEnded();
			return;
		}
		const framesSeen = opts.framesSeen;
		if (!framesSeen) return;
		const before = framesSeen();
		pending = setTimer(() => {
			pending = null;
			if (doc.visibilityState !== "visible") return;
			const now = track();
			if (now && now.readyState !== "ended" && framesSeen() === before) onEnded();
		}, opts.stallMs ?? CAMERA_RETURN_STALL_MS);
	};
	doc.addEventListener("visibilitychange", onVisible);
	return () => {
		if (pending != null) clearTimer(pending);
		doc.removeEventListener("visibilitychange", onVisible);
	};
}
