/**
 * The pulse check's inputs, recorded (`createRppgSession({ recordPulseCheckInputs: true })`), and
 * their replay (`replayPulseCheck`).
 *
 * Why: a rule of the check (such as the four dim-light candidates in PulseCheckRules) can only be
 * judged against a reference sensor on the seconds it ran. An app that saves only the number it
 * showed cannot say what a rule that was off would have shown. This keeps exactly what the check
 * was handed, in order, and the session's own reads of it, so any rule setting can be replayed
 * offline on the same seconds, through the same PulseCheck code.
 *
 * What it keeps, as events in the order they happened (PulseCheckInputEvent):
 * - every `push`: the frame's time, the colour of each face region handed over (forehead, left
 *   cheek, right cheek), the wall beside the face (on the tracker's continuous scale) and the same
 *   wall as the camera read it, why no wall was found, and the head's position (or that the face
 *   mesh found none, or that none was handed over);
 * - every `faceLost` (a frame with no forehead and cheeks);
 * - every `getMetrics()` read of the session: the rate it showed, and the session's own reason for
 *   showing none whatever the check held ("no_face", "no_frames", "processor_failed").
 *
 * It changes nothing: it reads the arguments and then calls the check exactly as before. With the
 * option off the session builds a plain PulseCheck and none of this code runs.
 *
 * Memory is bounded: the newest `seconds` (PULSE_CHECK_RECORDING_SECONDS by default) are kept, and
 * at most PULSE_CHECK_RECORDING_EVENTS_PER_SECOND events per second of that, in a ring buffer.
 * Measured (Node 22, frames with wall, raw wall and head, one read per frame, 30 a second): 5 minutes
 * is 18,000 events, about 7 MB held and 3.6 MB as JSON; a longer session stays at that. `dropped`
 * counts events let go from the start.
 *
 * Exactness: a replay with the recording's own rules gives back every state and every shown number
 * of the live session, provided nothing was dropped (`dropped: 0`). A recording that let its start
 * go replays as a check that began at its first kept event; its first numbers can then differ from
 * what was shown, until the check's memory of the earlier frames would have run out.
 */
import { RPPG_WEB_BUILD_VERSION } from "./buildInfo.js";
import { PULSE_CHECK_RULE_NAMES, PulseCheck, } from "./pulseCheck.js";
/** The `format` field of every recording. */
export const PULSE_CHECK_RECORDING_FORMAT = "rppg-web/pulse-check-inputs";
/** The `version` field: raised whenever the meaning of a field changes. A replay refuses other versions. */
export const PULSE_CHECK_RECORDING_VERSION = 1;
/** How many seconds a recording keeps by default: the newest 5 minutes. */
export const PULSE_CHECK_RECORDING_SECONDS = 300;
/**
 * The most events kept per second of `seconds`: a 60 frames a second camera with one session read
 * per frame. A faster stream keeps fewer seconds rather than more memory.
 */
export const PULSE_CHECK_RECORDING_EVENTS_PER_SECOND = 120;
const rgb3 = (c) => [c.r, c.g, c.b];
/**
 * A PulseCheck that also keeps what it is fed (see the file comment). createRppgSession builds one
 * when `recordPulseCheckInputs` is set; an app that builds its own DemoRunner and RppgSession can
 * pass one as their check.
 */
export class RecordingPulseCheck extends PulseCheck {
    constructor(opts = {}) {
        super({ rules: opts.rules });
        /** A fixed-size circular buffer: `recCount` events from index `recHead`, oldest first. */
        this.recRing = [];
        /** The clock each kept event is filed under: the newest frame time seen when it arrived (or the first one, for events before it). */
        this.recFiled = [];
        this.recHead = 0;
        this.recCount = 0;
        this.recDropped = 0;
        /** The newest finite frame time seen, the clock that events without their own time are filed under. */
        this.recLastT = null;
        const seconds = opts.seconds ?? PULSE_CHECK_RECORDING_SECONDS;
        if (!(seconds > 0) || !Number.isFinite(seconds))
            throw new RangeError(`recordPulseCheckInputs seconds must be a positive number, not ${seconds}`);
        this.recSeconds = seconds;
        this.recCap = Math.max(1, Math.ceil(seconds * PULSE_CHECK_RECORDING_EVENTS_PER_SECOND));
    }
    push(timestampMs, regions, wall, wallMiss, head, wallRaw) {
        this.keep([
            "f",
            timestampMs,
            regions.map(rgb3),
            wall ? rgb3(wall) : null,
            wallRaw ? rgb3(wallRaw) : null,
            wallMiss ?? null,
            head === undefined
                ? false
                : head === null
                    ? null
                    : head.yawDeg != null
                        ? [head.x, head.y, head.faceWidth, head.mouthOpen ?? null, head.yawDeg, head.pitchDeg ?? null, head.rollDeg ?? null]
                        : head.mouthOpen != null
                            ? [head.x, head.y, head.faceWidth, head.mouthOpen]
                            : [head.x, head.y, head.faceWidth],
        ], timestampMs);
        super.push(timestampMs, regions, wall, wallMiss, head, wallRaw);
    }
    faceLost(timestampMs) {
        this.keep(["l", timestampMs], timestampMs);
        super.faceLost(timestampMs);
    }
    /** A session read: the rate it showed, and its own reason for showing none (RppgSession.getMetrics calls this). */
    noteRead(bpm, reason) {
        this.keep(["r", this.recLastT, bpm, reason], null);
    }
    /** A copy of what is kept now, oldest event first. */
    getRecording() {
        const events = [];
        for (let i = 0; i < this.recCount; i++)
            events.push(this.recRing[(this.recHead + i) % this.recCap]);
        return {
            format: PULSE_CHECK_RECORDING_FORMAT,
            version: PULSE_CHECK_RECORDING_VERSION,
            build: RPPG_WEB_BUILD_VERSION,
            rules: { ...this.rules },
            seconds: this.recSeconds,
            dropped: this.recDropped,
            events,
        };
    }
    keep(event, t) {
        if (t != null && Number.isFinite(t)) {
            // Events kept before the first frame time are filed under it.
            if (this.recLastT == null)
                for (let i = 0; i < this.recCount; i++)
                    this.recFiled[(this.recHead + i) % this.recCap] = t;
            this.recLastT = this.recLastT == null ? t : Math.max(this.recLastT, t);
        }
        if (this.recCount === this.recCap)
            this.dropOldest();
        const at = (this.recHead + this.recCount) % this.recCap;
        this.recRing[at] = event;
        this.recFiled[at] = this.recLastT ?? Number.NEGATIVE_INFINITY;
        this.recCount += 1;
        // Let go of events filed before the window, oldest first; the newest event always stays.
        if (this.recLastT == null)
            return;
        const oldest = this.recLastT - this.recSeconds * 1000;
        while (this.recCount > 1 && this.recFiled[this.recHead] < oldest)
            this.dropOldest();
    }
    dropOldest() {
        this.recRing[this.recHead] = undefined;
        this.recHead = (this.recHead + 1) % this.recCap;
        this.recCount -= 1;
        this.recDropped += 1;
    }
}
function checkHeader(r) {
    if (r.format !== PULSE_CHECK_RECORDING_FORMAT)
        throw new Error(`not a pulse-check recording: format is ${JSON.stringify(r.format)}, expected "${PULSE_CHECK_RECORDING_FORMAT}"`);
    if (r.version !== PULSE_CHECK_RECORDING_VERSION)
        throw new Error(`pulse-check recording version ${JSON.stringify(r.version)} is not version ${PULSE_CHECK_RECORDING_VERSION}, which this build reads`);
}
const toRgb = (c) => ({ r: c[0], g: c[1], b: c[2] });
/**
 * Replays a recording through a fresh PulseCheck, the same code the session runs.
 *
 * `rules`: as the session option `pulseCheckRules` (each rule left out takes its default); left out,
 * the rules the recording was made with, and a rule the recording does not name is off: it did not
 * exist in the build that made it, so its check ran without it. With the recording's own rules and
 * `dropped: 0`, every read's `bpm` equals its `live`.
 */
export function replayPulseCheck(recording, options = {}) {
    checkHeader(recording);
    const own = Object.fromEntries(PULSE_CHECK_RULE_NAMES.map((name) => [name, recording.rules[name] === true]));
    const check = new PulseCheck({ rules: options.rules ?? own });
    const reads = [];
    const evaluations = [];
    for (const e of recording.events) {
        if (e[0] === "f") {
            const [, t, regions, wall, wallRaw, wallMiss, head] = e;
            const before = check.evaluations;
            check.push(t, regions.map(toRgb), wall ? toRgb(wall) : undefined, wallMiss ?? undefined, head === false ? undefined : head === null ? null : { x: head[0], y: head[1], faceWidth: head[2] }, wallRaw ? toRgb(wallRaw) : undefined);
            if (check.evaluations !== before) {
                const state = check.getState();
                evaluations.push({ t, bpm: state.verdict === "measured" ? state.bpm : null, state });
            }
        }
        else if (e[0] === "l")
            check.faceLost(e[1]);
        else if (e[0] === "r") {
            const state = check.getState();
            const reason = e[3];
            reads.push({
                t: e[1],
                bpm: reason != null ? null : state.verdict === "measured" ? state.bpm : null,
                live: e[2],
                reason,
                state,
            });
        }
    }
    return { reads, evaluations };
}
// JSON has no NaN, no infinities and no negative zero. The check is handed whatever the frame gave,
// so these are written as strings and read back as numbers; no other string field takes these values.
const SPECIAL = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, "-Infinity": Number.NEGATIVE_INFINITY, "-0": -0 };
/** A recording as JSON text, every number kept exactly (see parsePulseCheckRecording). */
export function serializePulseCheckRecording(recording) {
    return JSON.stringify(recording, (_key, v) => typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? (Object.is(v, -0) ? "-0" : String(v)) : v);
}
/** Reads a recording written by serializePulseCheckRecording; throws on another format or version. */
export function parsePulseCheckRecording(text) {
    const r = JSON.parse(text, (_key, v) => (typeof v === "string" && v in SPECIAL ? SPECIAL[v] : v));
    checkHeader(r);
    return r;
}
