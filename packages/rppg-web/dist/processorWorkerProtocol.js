/**
 * The worker answers at most once per this much SAMPLE time; reads in between return its last
 * answer. A heartbeat is about 1 s and a display updates about once a second, so 4 answers a
 * second lose nothing, and the main thread is not flooded with state messages.
 */
export const ANALYSIS_EVERY_MS = 250;
