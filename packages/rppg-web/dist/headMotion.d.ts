/** One frame of the head: [time ms, x, y, face width], pixels (headCentre). */
export type HeadRow = [number, number, number, number];
/**
 * How far the head's movement AT THE RATE must stand above the rest of its movement (dB), with the
 * strongest other rhythm taken out of the rest, for the rate to count as the movement's. Set
 * together with HEAD_MIN_SIZE, between still heads with a pulse and generated faces with no pulse
 * nodding, with and without a second sway. The 5 dB it replaced was set on the statistic before
 * (the strongest line against every other rhythm, which a second sway could hide a nod under).
 * Pinned in pulseCheckHead.test.ts.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const HEAD_MIN_SNR_DB = 3.9;
/**
 * The smallest movement at the rate that can be a nod: the line's amplitude over the face's width.
 * A heartbeat shakes the head too, and in a still person that shake can be the head's strongest
 * rhythm, but it is tiny next to a nod. A clean 3 px nod on a 190 px face is 1.6% of its width.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const HEAD_MIN_SIZE = 0.003;
/** Why a window's head movement cannot be judged (headAtRate). */
export type HeadBlind = "rows" | "start" | "end" | "gap" | "rate";
/** The head's movement at a rate on one axis (headAtRate). */
export type HeadAtRate = {
    /** The movement at the rate (its line and second harmonic) over the rest, the strongest other rhythm left out (dB). */
    snrDb: number;
    /** The line's amplitude over the face's width. */
    size: number;
};
/**
 * The head's movement at `bpm` in the 16 s window ending at `atMs`, one entry per axis that has a
 * line there (side to side, then up and down), or why the window cannot be judged ('blind'): fewer
 * than HEAD_MIN_ROWS rows, rows starting or ending more than 1 s from the window's edges, a gap over
 * 1 s, or fewer than HEAD_MIN_ROWS_PER_CYCLE rows per cycle of the rate. Judged at the rate claimed,
 * on a fixed grid (bins of 0.0625 Hz whatever span the rows have).
 */
export declare function headAtRate(head: readonly HeadRow[], atMs: number, bpm: number): {
    axes: HeadAtRate[];
} | {
    blind: HeadBlind;
};
/** Whether the head's movement carries a rate in a window ('carried'), does not ('clear'), or cannot be judged ('blind'). */
export type HeadJudgement = "carried" | "clear" | "blind";
/**
 * Whether the head's movement carries `bpm` in the window ending at `atMs`: on either axis, both
 * HEAD_MIN_SNR_DB above the rest of its movement and HEAD_MIN_SIZE of the face's width. A window the
 * head's rows do not cover is 'blind', never 'clear'.
 */
export declare function headJudge(head: readonly HeadRow[], atMs: number, bpm: number): HeadJudgement;
/** Whether the head's movement carries `bpm` in the window ending at `atMs` (headJudge is 'carried'). */
export declare function headCarries(head: readonly HeadRow[], atMs: number, bpm: number): boolean;
/**
 * Whether the head's movement carried `bpm` in each of the last OWN_PULSE_STRONG_STREAK one-second
 * windows ending at `atMs` (headCarries in each): rule headMotion's withhold, the state's headMatch.
 * Judged over the windows at once, like the wall check, so one window's coincidence withholds nothing.
 */
export declare function headMatches(head: readonly HeadRow[], atMs: number, bpm: number): boolean;
/**
 * Whether the head keeps time with `bpm` in the window ending at `atMs`: at the rate, or at half the rate. A walk sways
 * the head once a stride, half the step rate, and the sway's second harmonic lands on the step rate in the light on the
 * face; judged at the rate alone a recorded walk was caught 24 of 32 shown seconds, with half the rate too 32 of 32,
 * at a cost of 4 of 1,736 shown seconds on still phone recordings and 4 of 4,107 more on still laptop ones.
 */
export declare function headKeepsTime(head: readonly HeadRow[], atMs: number, bpm: number): boolean;
/**
 * The head is moving: its spread over the last 8 s (position and size, over the face's width) above HEAD_MOVING_MIN,
 * the bar "hold still" uses (pulseGuide MOVE_MAX, movementOf, the same measure). A still head cannot keep time with a
 * walk, and a resting heartbeat nudges the head at its own rate: gated so, the recorded walk was still caught 32 of 32
 * shown seconds, and 17 of the 64 seconds caught on still recordings were left alone (laptop 6, phone 1, a Mac 10).
 */
export declare const HEAD_MOVING_MIN = 0.07;
export declare function headMoving(head: readonly HeadRow[], atMs: number): boolean;
/** headKeepsTime in each of the last OWN_PULSE_STRONG_STREAK windows: a held number the head has kept time with. */
export declare function headKeepsTimeAll(head: readonly HeadRow[], atMs: number, bpm: number): boolean;
//# sourceMappingURL=headMotion.d.ts.map