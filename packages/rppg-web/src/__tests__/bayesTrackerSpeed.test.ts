import { BpmBayesTracker } from "../bpmBayesTracker";
// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => unknown;
const fixture = require("./fixtures/bayesTrackerSequence.json") as { out: unknown[]; posterior: number[] };

// The tracker's motion step was the largest single cost on the page (19% of CPU in a browser profile): a Gaussian per
// pair of grid points for every pair of harmonic modes. Computing each Gaussian once per pair of points must give
// exactly the same tracker: this replays a long seeded sequence recorded from the code before the change.
test("the Bayes tracker gives exactly the recorded outputs and posterior", () => {
	let seed = 12345;
	const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const t = new BpmBayesTracker();
	const out: unknown[] = [];
	for (let i = 0; i < 400; i++) {
		const hr = 70 + 15 * Math.sin(i / 60) + (rnd() - 0.5) * 4;
		const m = [
			{ source: "spectral" as const, bpm: rnd() < 0.15 ? hr / 2 : hr, confidence: rnd() },
			{ source: "acf" as const, bpm: hr + (rnd() - 0.5) * 6, confidence: rnd() },
			{ source: "peaks" as const, bpm: rnd() < 0.1 ? null : hr * (rnd() < 0.1 ? 2 : 1), confidence: rnd() },
		];
		const e = t.update(m as never, 1 / 30 + rnd() * 0.5, { motion: rnd() * 0.5, snrDb: (rnd() - 0.5) * 20, quality: rnd() } as never);
		out.push([e.bpm, e.confidence, e.ambiguity, (e as { mode?: unknown }).mode ?? null]);
	}
	expect(out).toEqual(fixture.out);
	expect(Array.from(t.getSnapshot().posterior)).toEqual(fixture.posterior);
});
